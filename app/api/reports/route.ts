import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { compareClassNames } from '@/lib/domain/reading-schedule-rules';
import {
  computeCirculationSummary,
  doesAcquisitionTextMatchClass,
  doesTargetGradeMatchClass,
  getReportCategoryFilterHint,
  getReportClassFilterHint,
  isCirculationReportType,
  normalizeClassFilter,
  type CirculationCategoryBreakdownItem,
} from '@/lib/domain/report-filters';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeDateParam(raw: string | null, fallback: string): string {
  const trimmed = String(raw || '').trim();
  return ISO_DATE_RE.test(trimmed) ? trimmed : fallback;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('reports.read');
  if (guard.errorResponse) return guard.errorResponse;

  const sp = req.nextUrl.searchParams;
  const type = String(sp.get('type') || 'loans').trim();
  const fromDate = sanitizeDateParam(sp.get('fromDate'), '2020-01-01');
  const toDate = sanitizeDateParam(sp.get('toDate'), '2099-12-31');
  const rawCategoryId = String(sp.get('categoryId') || '').trim();
  const catIdNum = /^\d+$/.test(rawCategoryId) ? Number(rawCategoryId) : null;
  const status = String(sp.get('status') || '').trim();
  const className = normalizeClassFilter(sp.get('className'));

  const db = getDb();
  let rows: Array<Record<string, unknown>> = [];

  if (type === 'collection' || type === 'available') {
    const availClause = type === 'available' ? "AND bc.status = 'Tersedia'" : '';
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const params: Array<string | number> = [];
    if (catIdNum !== null) params.push(catIdNum);

    const rawBooks = db
      .prepare(
        `SELECT b.id, b.title as Judul, COALESCE(b.isbn, '-') as ISBN, c.name as Kategori,
                COALESCE(NULLIF(b.target_grade, ''), 'Semua Kelas (1–6 SD)') as Target_Kelas,
                COUNT(bc.id) as Total_Eksemplar,
                SUM(CASE WHEN bc.status = 'Tersedia' THEN 1 ELSE 0 END) as Tersedia,
                SUM(CASE WHEN bc.status = 'Dipinjam' THEN 1 ELSE 0 END) as Dipinjam
         FROM books b
         LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN book_copies bc ON bc.book_id = b.id AND bc.archived_at IS NULL ${availClause}
         WHERE b.archived_at IS NULL ${catClause}
         GROUP BY b.id
         ORDER BY b.title ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    if (className) {
      const borrowedByClassRows = db
        .prepare(
          `SELECT bc.book_id, COUNT(li.id) as borrow_count
           FROM loan_items li
           JOIN loans l ON l.id = li.loan_id
           JOIN members m ON m.id = l.member_id
           JOIN book_copies bc ON bc.id = li.copy_id
           WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))
           GROUP BY bc.book_id`
        )
        .all(className) as Array<{ book_id: number; borrow_count: number }>;
      const borrowMap = new Map(borrowedByClassRows.map((r) => [r.book_id, r.borrow_count]));

      rows = rawBooks
        .filter((row) => {
          const bookId = Number(row.id);
          return (
            doesTargetGradeMatchClass(String(row.Target_Kelas || ''), className) ||
            borrowMap.has(bookId)
          );
        })
        .map((row) => {
          const bookId = Number(row.id);
          return {
            Judul: row.Judul,
            ISBN: row.ISBN,
            Kategori: row.Kategori,
            Target_Kelas: row.Target_Kelas,
            Total_Eksemplar: row.Total_Eksemplar,
            Tersedia: row.Tersedia,
            Dipinjam: row.Dipinjam,
            Dipinjam_Rombel: borrowMap.get(bookId) || 0,
          };
        });
    } else {
      rows = rawBooks.map((row) => ({
        Judul: row.Judul,
        ISBN: row.ISBN,
        Kategori: row.Kategori,
        Target_Kelas: row.Target_Kelas,
        Total_Eksemplar: row.Total_Eksemplar,
        Tersedia: row.Tersedia,
        Dipinjam: row.Dipinjam,
      }));
    }
  } else if (type === 'circulation') {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (className) params.push(className);
    if (catIdNum !== null) params.push(catIdNum);

    rows = db
      .prepare(
        `SELECT l.loan_number as No_Transaksi,
                m.full_name as Anggota,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Rombel_Kelas,
                b.title as Judul_Buku,
                COALESCE(c.name, 'Umum') as Kategori_Buku,
                bc.inventory_code as Kode_Eksemplar,
                l.loan_date as Tanggal_Pinjam,
                COALESCE(li.due_date, l.due_date) as Jatuh_Tempo,
                COALESCE(date(r.returned_at), date(li.returned_at), '-') as Tanggal_Kembali,
                CASE
                  WHEN r.id IS NOT NULL THEN
                    CASE
                      WHEN r.status = 'Terlambat' THEN 'Dikembalikan (Terlambat)'
                      ELSE 'Dikembalikan'
                    END
                  WHEN li.returned_at IS NOT NULL THEN 'Dikembalikan'
                  WHEN l.status = 'Terlambat' OR date(COALESCE(li.due_date, l.due_date)) < date('now') THEN 'Terlambat'
                  ELSE 'Dipinjam'
                END as Status,
                COALESCE(r.fine_amount, 0) as Denda
         FROM loan_items li
         JOIN loans l ON l.id = li.loan_id
         JOIN members m ON m.id = l.member_id
         JOIN book_copies bc ON bc.id = li.copy_id
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN returns r ON r.loan_item_id = li.id
         WHERE l.loan_date BETWEEN ? AND ? ${classClause} ${catClause}
         ORDER BY l.loan_date DESC, l.id DESC, li.id ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'loans' || type === 'overdue') {
    const statusClause =
      type === 'overdue' ? "AND l.status = 'Terlambat'" : status ? 'AND l.status = ?' : '';
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (type !== 'overdue' && status) params.push(status);
    if (className) params.push(className);
    if (catIdNum !== null) params.push(catIdNum);

    rows = db
      .prepare(
        `SELECT l.loan_number as No_Transaksi, m.member_code as Kode_Anggota, m.full_name as Nama_Anggota,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Rombel_Kelas,
                GROUP_CONCAT(DISTINCT COALESCE(c.name, 'Umum')) as Kategori_Buku,
                l.loan_date as Tanggal_Pinjam, l.due_date as Jatuh_Tempo, l.status as Status,
                COUNT(DISTINCT li.id) as Jumlah_Buku
         FROM loans l
         JOIN members m ON m.id = l.member_id
         JOIN loan_items li ON li.loan_id = l.id
         JOIN book_copies bc ON bc.id = li.copy_id
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN categories c ON c.id = b.category_id
         WHERE l.loan_date BETWEEN ? AND ? ${statusClause} ${classClause} ${catClause}
         GROUP BY l.id
         ORDER BY l.loan_date DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'returns') {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (className) params.push(className);
    if (catIdNum !== null) params.push(catIdNum);

    rows = db
      .prepare(
        `SELECT r.return_number as No_Pengembalian, l.loan_number as No_Peminjaman,
                m.full_name as Anggota,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Rombel_Kelas,
                b.title as Judul_Buku,
                COALESCE(c.name, 'Umum') as Kategori_Buku,
                bc.inventory_code as Kode_Inventaris,
                r.returned_at as Tanggal_Kembali, r.condition as Kondisi, r.status as Status,
                r.overdue_days as Hari_Terlambat, r.fine_amount as Denda
         FROM returns r
         JOIN loans l ON l.id = r.loan_id
         JOIN members m ON m.id = l.member_id
         JOIN book_copies bc ON bc.id = r.copy_id
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN categories c ON c.id = b.category_id
         WHERE date(r.returned_at) BETWEEN ? AND ? ${classClause} ${catClause}
         ORDER BY r.returned_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'active_members' || type === 'most_active_members') {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const params: Array<string | number> = [];
    if (className) params.push(className);

    rows = db
      .prepare(
        `SELECT m.member_code as No_Anggota, m.full_name as Nama, mt.name as Jenis,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Unit_Kelas,
                m.status as Status, m.expires_at as Berlaku_Hingga,
                COUNT(l.id) as Total_Transaksi
         FROM members m
         JOIN membership_types mt ON mt.id = m.membership_type_id
         LEFT JOIN loans l ON l.member_id = m.id
         WHERE m.archived_at IS NULL AND m.status = 'Aktif' ${classClause}
         GROUP BY m.id
         ORDER BY ${type === 'most_active_members' ? 'Total_Transaksi DESC, m.full_name ASC' : 'm.full_name ASC'}`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'popular_books') {
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    if (className) {
      const params: Array<string | number> = [className, fromDate, toDate];
      if (catIdNum !== null) params.push(catIdNum);
      rows = db
        .prepare(
          `SELECT b.title as Judul, c.name as Kategori,
                  ? as Rombel_Kelas,
                  COUNT(li.id) as Total_Dipinjam
           FROM books b
           LEFT JOIN categories c ON c.id = b.category_id
           JOIN book_copies bc ON bc.book_id = b.id
           JOIN loan_items li ON li.copy_id = bc.id
           JOIN loans l ON l.id = li.loan_id
           JOIN members m ON m.id = l.member_id
           WHERE b.archived_at IS NULL
             AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))
             AND l.loan_date BETWEEN ? AND ?
             ${catClause}
           GROUP BY b.id
           ORDER BY Total_Dipinjam DESC, b.title ASC`
        )
        .all(className, ...params) as Array<Record<string, unknown>>;
    } else {
      const params: Array<string | number> = [];
      if (catIdNum !== null) params.push(catIdNum);
      rows = db
        .prepare(
          `SELECT b.title as Judul, c.name as Kategori, COUNT(li.id) as Total_Dipinjam
           FROM books b
           LEFT JOIN categories c ON c.id = b.category_id
           LEFT JOIN book_copies bc ON bc.book_id = b.id
           LEFT JOIN loan_items li ON li.copy_id = bc.id
           WHERE b.archived_at IS NULL ${catClause}
           GROUP BY b.id
           ORDER BY Total_Dipinjam DESC, b.title ASC`
        )
        .all(...params) as Array<Record<string, unknown>>;
    }
  } else if (type === 'popular_categories') {
    const catClause = catIdNum !== null ? 'WHERE c.id = ?' : '';
    if (className) {
      const params: Array<string | number> = [className, fromDate, toDate, className];
      if (catIdNum !== null) params.push(catIdNum);
      rows = db
        .prepare(
          `SELECT c.code as Kode, c.name as Kategori,
                  ? as Rombel_Kelas,
                  COUNT(DISTINCT b.id) as Jumlah_Judul,
                  COUNT(DISTINCT CASE
                    WHEN l.loan_date BETWEEN ? AND ?
                     AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))
                    THEN li.id
                  END) as Total_Peminjaman
           FROM categories c
           LEFT JOIN books b ON b.category_id = c.id AND b.archived_at IS NULL
           LEFT JOIN book_copies bc ON bc.book_id = b.id
           LEFT JOIN loan_items li ON li.copy_id = bc.id
           LEFT JOIN loans l ON l.id = li.loan_id
           LEFT JOIN members m ON m.id = l.member_id
           ${catClause}
           GROUP BY c.id
           ORDER BY Total_Peminjaman DESC, c.name ASC`
        )
        .all(...params) as Array<Record<string, unknown>>;
    } else {
      const params: Array<string | number> = [];
      if (catIdNum !== null) params.push(catIdNum);
      rows = db
        .prepare(
          `SELECT c.code as Kode, c.name as Kategori, COUNT(DISTINCT b.id) as Jumlah_Judul, COUNT(li.id) as Total_Peminjaman
           FROM categories c
           LEFT JOIN books b ON b.category_id = c.id AND b.archived_at IS NULL
           LEFT JOIN book_copies bc ON bc.book_id = b.id
           LEFT JOIN loan_items li ON li.copy_id = bc.id
           ${catClause}
           GROUP BY c.id
           ORDER BY Total_Peminjaman DESC, c.name ASC`
        )
        .all(...params) as Array<Record<string, unknown>>;
    }
  } else if (type === 'fines') {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (className) params.push(className);

    rows = db
      .prepare(
        `SELECT f.fine_number as No_Denda, m.full_name as Anggota,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Rombel_Kelas,
                f.fine_type as Jenis_Denda,
                f.amount as Tagihan, f.paid_amount as Dibayar, f.waived_amount as Dibebaskan,
                f.status as Status, date(f.created_at) as Tanggal
         FROM fines f
         JOIN members m ON m.id = f.member_id
         WHERE date(f.created_at) BETWEEN ? AND ? ${classClause}
         ORDER BY f.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'payments') {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (className) params.push(className);

    rows = db
      .prepare(
        `SELECT p.payment_number as No_Pembayaran, f.fine_number as No_Denda, m.full_name as Anggota,
                COALESCE(NULLIF(m.unit_or_class, ''), '-') as Rombel_Kelas,
                p.amount as Nominal, p.method as Metode, date(p.paid_at) as Tanggal_Bayar
         FROM payments p
         JOIN fines f ON f.id = p.fine_id
         JOIN members m ON m.id = p.member_id
         WHERE date(p.paid_at) BETWEEN ? AND ? ${classClause}
         ORDER BY p.id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'acquisitions') {
    const rawAcq = db
      .prepare(
        `SELECT a.id, a.request_number as No_Pengadaan, a.title_summary as Ringkasan,
                COALESCE(s.name, '-') as Pemasok, a.total_estimated_cost as Estimasi_Biaya,
                a.status as Status, date(a.created_at) as Tanggal_Pengajuan,
                a.notes as Catatan
         FROM acquisitions a
         LEFT JOIN suppliers s ON s.id = a.supplier_id
         WHERE date(a.created_at) BETWEEN ? AND ?
         ORDER BY a.id DESC`
      )
      .all(fromDate, toDate) as Array<Record<string, unknown>>;

    if (className) {
      const itemRows = db
        .prepare('SELECT acquisition_id, title FROM acquisition_items')
        .all() as Array<{ acquisition_id: number; title: string }>;
      const itemsByAcq = new Map<number, string[]>();
      for (const it of itemRows) {
        const list = itemsByAcq.get(it.acquisition_id) || [];
        list.push(it.title);
        itemsByAcq.set(it.acquisition_id, list);
      }

      rows = rawAcq
        .filter((a) =>
          doesAcquisitionTextMatchClass(
            {
              titleSummary: String(a.Ringkasan || ''),
              notes: String(a.Catatan || ''),
              itemTitles: itemsByAcq.get(Number(a.id)) || [],
            },
            className
          )
        )
        .map((a) => ({
          No_Pengadaan: a.No_Pengadaan,
          Ringkasan: a.Ringkasan,
          Pemasok: a.Pemasok,
          Estimasi_Biaya: a.Estimasi_Biaya,
          Status: a.Status,
          Tanggal_Pengajuan: a.Tanggal_Pengajuan,
        }));
    } else {
      rows = rawAcq.map((a) => ({
        No_Pengadaan: a.No_Pengadaan,
        Ringkasan: a.Ringkasan,
        Pemasok: a.Pemasok,
        Estimasi_Biaya: a.Estimasi_Biaya,
        Status: a.Status,
        Tanggal_Pengajuan: a.Tanggal_Pengajuan,
      }));
    }
  } else if (type === 'inventory') {
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const params: Array<string | number> = [];
    if (catIdNum !== null) params.push(catIdNum);

    const rawInv = db
      .prepare(
        `SELECT bc.id, bc.inventory_code as Kode_Inventaris, bc.barcode as Barcode, b.title as Judul,
                COALESCE(NULLIF(b.target_grade, ''), 'Semua Kelas (1–6 SD)') as Target_Kelas,
                COALESCE(s.code, '-') as Rak, bc.condition as Kondisi, bc.status as Status, bc.price as Nilai_Buku
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN shelves s ON s.id = bc.shelf_id
         WHERE bc.archived_at IS NULL ${catClause}
         ORDER BY bc.inventory_code ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    if (className) {
      const classCopyIds = new Set(
        (
          db
            .prepare(
              `SELECT DISTINCT li.copy_id
               FROM loan_items li
               JOIN loans l ON l.id = li.loan_id
               JOIN members m ON m.id = l.member_id
               WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))`
            )
            .all(className) as Array<{ copy_id: number }>
        ).map((r) => r.copy_id)
      );

      rows = rawInv
        .filter(
          (r) =>
            doesTargetGradeMatchClass(String(r.Target_Kelas || ''), className) ||
            classCopyIds.has(Number(r.id))
        )
        .map((r) => ({
          Kode_Inventaris: r.Kode_Inventaris,
          Barcode: r.Barcode,
          Judul: r.Judul,
          Target_Kelas: r.Target_Kelas,
          Rak: r.Rak,
          Kondisi: r.Kondisi,
          Status: r.Status,
          Nilai_Buku: r.Nilai_Buku,
        }));
    } else {
      rows = rawInv.map((r) => ({
        Kode_Inventaris: r.Kode_Inventaris,
        Barcode: r.Barcode,
        Judul: r.Judul,
        Target_Kelas: r.Target_Kelas,
        Rak: r.Rak,
        Kondisi: r.Kondisi,
        Status: r.Status,
        Nilai_Buku: r.Nilai_Buku,
      }));
    }
  } else if (type === 'lost_damaged') {
    const catClause = catIdNum !== null ? 'AND b.category_id = ?' : '';
    const classClause = className
      ? `AND EXISTS (
           SELECT 1 FROM loan_items li
           JOIN loans l ON l.id = li.loan_id
           JOIN members m ON m.id = l.member_id
           WHERE li.copy_id = bc.id AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))
         )`
      : '';
    const params: Array<string | number> = [];
    if (catIdNum !== null) params.push(catIdNum);
    if (className) params.push(className);

    rows = db
      .prepare(
        `SELECT bc.inventory_code as Kode_Inventaris, bc.barcode as Barcode, b.title as Judul,
                COALESCE(s.code, '-') as Rak, bc.condition as Kondisi, bc.status as Status, bc.price as Nilai_Buku
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN shelves s ON s.id = bc.shelf_id
         WHERE bc.archived_at IS NULL
           AND (bc.condition IN ('Rusak Ringan', 'Rusak Berat', 'Hilang') OR bc.status IN ('Hilang', 'Perbaikan'))
           ${catClause}
           ${classClause}
         ORDER BY bc.inventory_code ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'class_rosters') {
    const classClause = className ? 'AND LOWER(TRIM(sc.class_name)) = LOWER(TRIM(?))' : '';
    const params: Array<string | number> = [fromDate, toDate, fromDate, toDate, fromDate, toDate];
    if (className) params.push(className);

    const rawRows = db
      .prepare(
        `SELECT sc.class_name as Rombel,
                sc.grade_level as Tingkat,
                sc.homeroom_teacher as Wali_Kelas,
                sc.companion_teacher as Guru_Pendamping,
                COALESCE(NULLIF(sc.room_label, ''), '-') as Ruang,
                (SELECT COUNT(*) FROM class_students cs WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL) as Siswa_Rombel,
                (SELECT COUNT(*) FROM members m WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(sc.class_name)) AND m.archived_at IS NULL) as Anggota_Perpus,
                (SELECT COUNT(*) FROM reading_schedules rs WHERE rs.class_name = sc.class_name AND rs.archived_at IS NULL AND rs.status != 'Dibatalkan') as Jadwal_Aktif,
                (SELECT COUNT(*) FROM reading_schedule_logs l JOIN reading_schedules rs2 ON rs2.id = l.schedule_id WHERE rs2.class_name = sc.class_name AND l.session_date BETWEEN ? AND ?) as Total_Sesi,
                (SELECT COALESCE(SUM(l.students_present), 0) FROM reading_schedule_logs l JOIN reading_schedules rs3 ON rs3.id = l.schedule_id WHERE rs3.class_name = sc.class_name AND l.session_date BETWEEN ? AND ?) as Total_Hadir,
                (SELECT COALESCE(SUM(l.books_read_count), 0) FROM reading_schedule_logs l JOIN reading_schedules rs4 ON rs4.id = l.schedule_id WHERE rs4.class_name = sc.class_name AND l.session_date BETWEEN ? AND ?) as Buku_Dibaca
         FROM school_classes sc
         WHERE sc.archived_at IS NULL ${classClause}
         ORDER BY sc.grade_level ASC, sc.class_name ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
    rawRows.sort((a, b) => compareClassNames(String(a.Rombel || ''), String(b.Rombel || '')));
    rows = rawRows;
  }

  const categories = db
    .prepare('SELECT id, name FROM categories ORDER BY name')
    .all() as Array<{ id: number; name: string }>;

  const selectedCategoryName =
    catIdNum !== null ? categories.find((c) => c.id === catIdNum)?.name || '' : '';

  let categoryBreakdown: CirculationCategoryBreakdownItem[] = [];
  if (isCirculationReportType(type)) {
    const classClause = className ? 'AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))' : '';
    if (type === 'returns') {
      const bParams: Array<string | number> = [fromDate, toDate];
      if (className) bParams.push(className);
      const rawBreakdown = db
        .prepare(
          `SELECT c.id as categoryId,
                  COALESCE(c.name, 'Umum') as categoryName,
                  COUNT(r.id) as total,
                  0 as borrowed,
                  COUNT(r.id) as returned,
                  SUM(CASE WHEN r.status = 'Terlambat' THEN 1 ELSE 0 END) as overdue,
                  COALESCE(SUM(r.fine_amount), 0) as totalFine
           FROM returns r
           JOIN loans l ON l.id = r.loan_id
           JOIN members m ON m.id = l.member_id
           JOIN book_copies bc ON bc.id = r.copy_id
           JOIN books b ON b.id = bc.book_id
           LEFT JOIN categories c ON c.id = b.category_id
           WHERE date(r.returned_at) BETWEEN ? AND ? ${classClause}
           GROUP BY c.id, COALESCE(c.name, 'Umum')
           ORDER BY total DESC, categoryName ASC`
        )
        .all(...bParams) as CirculationCategoryBreakdownItem[];
      categoryBreakdown = rawBreakdown;
    } else {
      const overdueOnlyClause = type === 'overdue' ? "AND l.status = 'Terlambat'" : '';
      const bParams: Array<string | number> = [fromDate, toDate];
      if (className) bParams.push(className);
      const rawBreakdown = db
        .prepare(
          `SELECT c.id as categoryId,
                  COALESCE(c.name, 'Umum') as categoryName,
                  COUNT(DISTINCT ${type === 'circulation' ? 'li.id' : 'l.id'}) as total,
                  SUM(CASE WHEN r.id IS NULL AND li.returned_at IS NULL AND l.status != 'Terlambat' AND date(COALESCE(li.due_date, l.due_date)) >= date('now') THEN 1 ELSE 0 END) as borrowed,
                  SUM(CASE WHEN r.id IS NOT NULL OR li.returned_at IS NOT NULL THEN 1 ELSE 0 END) as returned,
                  SUM(CASE WHEN r.id IS NULL AND li.returned_at IS NULL AND (l.status = 'Terlambat' OR date(COALESCE(li.due_date, l.due_date)) < date('now')) THEN 1 ELSE 0 END) as overdue,
                  COALESCE(SUM(COALESCE(r.fine_amount, 0)), 0) as totalFine
           FROM loan_items li
           JOIN loans l ON l.id = li.loan_id
           JOIN members m ON m.id = l.member_id
           JOIN book_copies bc ON bc.id = li.copy_id
           JOIN books b ON b.id = bc.book_id
           LEFT JOIN categories c ON c.id = b.category_id
           LEFT JOIN returns r ON r.loan_item_id = li.id
           WHERE l.loan_date BETWEEN ? AND ? ${overdueOnlyClause} ${classClause}
           GROUP BY c.id, COALESCE(c.name, 'Umum')
           ORDER BY total DESC, categoryName ASC`
        )
        .all(...bParams) as CirculationCategoryBreakdownItem[];
      categoryBreakdown = rawBreakdown;
    }
  }

  const circulationSummary = isCirculationReportType(type)
    ? computeCirculationSummary(rows)
    : null;

  const rawSchoolClasses = db
    .prepare(
      `SELECT class_name, grade_level, homeroom_teacher, companion_teacher, room_label
       FROM school_classes
       WHERE archived_at IS NULL
       ORDER BY grade_level ASC, class_name ASC`
    )
    .all() as Array<{
    class_name: string;
    grade_level: number;
    homeroom_teacher: string;
    companion_teacher: string;
    room_label: string;
  }>;
  rawSchoolClasses.sort((a, b) => compareClassNames(a.class_name, b.class_name));
  const schoolClasses = rawSchoolClasses.map((c) => ({
    className: c.class_name,
    gradeLevel: c.grade_level,
    homeroomTeacher: c.homeroom_teacher,
    companionTeacher: c.companion_teacher,
    roomLabel: c.room_label || '',
  }));

  const rombelKeys = new Set(schoolClasses.map((c) => c.className.trim().toLowerCase()));
  const rawUnits = db
    .prepare(
      `SELECT DISTINCT TRIM(unit_or_class) as unit_name
       FROM members
       WHERE archived_at IS NULL AND TRIM(unit_or_class) != ''
       ORDER BY unit_name ASC`
    )
    .all() as Array<{ unit_name: string }>;
  const otherUnits = rawUnits
    .map((u) => u.unit_name)
    .filter((u) => !rombelKeys.has(u.toLowerCase()));

  const hintParts = [
    getReportCategoryFilterHint(type, selectedCategoryName),
    getReportClassFilterHint(type, className),
  ].filter(Boolean);

  return NextResponse.json({
    type,
    className,
    categoryId: catIdNum !== null ? String(catIdNum) : '',
    selectedCategoryName,
    filterHint: hintParts.join(' '),
    circulationSummary,
    categoryBreakdown,
    rows,
    categories,
    schoolClasses,
    otherUnits,
  });
}

