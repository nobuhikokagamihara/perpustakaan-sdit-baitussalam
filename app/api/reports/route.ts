import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('reports.read');
  if (guard.errorResponse) return guard.errorResponse;

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') || 'loans';
  const fromDate = sp.get('fromDate') || '2020-01-01';
  const toDate = sp.get('toDate') || '2099-12-31';
  const categoryId = sp.get('categoryId') || '';
  const status = sp.get('status') || '';

  const db = getDb();
  let rows: Array<Record<string, unknown>> = [];

  if (type === 'collection' || type === 'available') {
    const availClause = type === 'available' ? "AND bc.status = 'Tersedia'" : '';
    const catClause = categoryId ? 'AND b.category_id = ?' : '';
    const params = categoryId ? [Number(categoryId)] : [];
    rows = db
      .prepare(
        `SELECT b.title as Judul, COALESCE(b.isbn, '-') as ISBN, c.name as Kategori,
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
  } else if (type === 'loans' || type === 'overdue') {
    const statusClause = type === 'overdue' ? "AND l.status = 'Terlambat'" : status ? 'AND l.status = ?' : '';
    const params: Array<string | number> = [fromDate, toDate];
    if (type !== 'overdue' && status) params.push(status);
    rows = db
      .prepare(
        `SELECT l.loan_number as No_Transaksi, m.member_code as Kode_Anggota, m.full_name as Nama_Anggota,
                l.loan_date as Tanggal_Pinjam, l.due_date as Jatuh_Tempo, l.status as Status,
                COUNT(li.id) as Jumlah_Buku
         FROM loans l
         JOIN members m ON m.id = l.member_id
         JOIN loan_items li ON li.loan_id = l.id
         WHERE l.loan_date BETWEEN ? AND ? ${statusClause}
         GROUP BY l.id
         ORDER BY l.loan_date DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;
  } else if (type === 'returns') {
    rows = db
      .prepare(
        `SELECT r.return_number as No_Pengembalian, l.loan_number as No_Peminjaman,
                m.full_name as Anggota, b.title as Judul_Buku, bc.inventory_code as Kode_Inventaris,
                r.returned_at as Tanggal_Kembali, r.condition as Kondisi, r.status as Status,
                r.overdue_days as Hari_Terlambat, r.fine_amount as Denda
         FROM returns r
         JOIN loans l ON l.id = r.loan_id
         JOIN members m ON m.id = l.member_id
         JOIN book_copies bc ON bc.id = r.copy_id
         JOIN books b ON b.id = bc.book_id
         WHERE date(r.returned_at) BETWEEN ? AND ?
         ORDER BY r.returned_at DESC`
      )
      .all(fromDate, toDate) as Array<Record<string, unknown>>;
  } else if (type === 'active_members' || type === 'most_active_members') {
    rows = db
      .prepare(
        `SELECT m.member_code as No_Anggota, m.full_name as Nama, mt.name as Jenis,
                m.unit_or_class as Unit_Kelas, m.status as Status, m.expires_at as Berlaku_Hingga,
                COUNT(l.id) as Total_Transaksi
         FROM members m
         JOIN membership_types mt ON mt.id = m.membership_type_id
         LEFT JOIN loans l ON l.member_id = m.id
         WHERE m.archived_at IS NULL AND m.status = 'Aktif'
         GROUP BY m.id
         ORDER BY ${type === 'most_active_members' ? 'Total_Transaksi DESC' : 'm.full_name ASC'}`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (type === 'popular_books') {
    rows = db
      .prepare(
        `SELECT b.title as Judul, c.name as Kategori, COUNT(li.id) as Total_Dipinjam
         FROM books b
         LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN book_copies bc ON bc.book_id = b.id
         LEFT JOIN loan_items li ON li.copy_id = bc.id
         WHERE b.archived_at IS NULL
         GROUP BY b.id
         ORDER BY Total_Dipinjam DESC`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (type === 'popular_categories') {
    rows = db
      .prepare(
        `SELECT c.code as Kode, c.name as Kategori, COUNT(DISTINCT b.id) as Jumlah_Judul, COUNT(li.id) as Total_Peminjaman
         FROM categories c
         LEFT JOIN books b ON b.category_id = c.id AND b.archived_at IS NULL
         LEFT JOIN book_copies bc ON bc.book_id = b.id
         LEFT JOIN loan_items li ON li.copy_id = bc.id
         GROUP BY c.id
         ORDER BY Total_Peminjaman DESC`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (type === 'fines') {
    rows = db
      .prepare(
        `SELECT f.fine_number as No_Denda, m.full_name as Anggota, f.fine_type as Jenis_Denda,
                f.amount as Tagihan, f.paid_amount as Dibayar, f.waived_amount as Dibebaskan,
                f.status as Status, date(f.created_at) as Tanggal
         FROM fines f
         JOIN members m ON m.id = f.member_id
         WHERE date(f.created_at) BETWEEN ? AND ?
         ORDER BY f.id DESC`
      )
      .all(fromDate, toDate) as Array<Record<string, unknown>>;
  } else if (type === 'payments') {
    rows = db
      .prepare(
        `SELECT p.payment_number as No_Pembayaran, f.fine_number as No_Denda, m.full_name as Anggota,
                p.amount as Nominal, p.method as Metode, date(p.paid_at) as Tanggal_Bayar
         FROM payments p
         JOIN fines f ON f.id = p.fine_id
         JOIN members m ON m.id = p.member_id
         WHERE date(p.paid_at) BETWEEN ? AND ?
         ORDER BY p.id DESC`
      )
      .all(fromDate, toDate) as Array<Record<string, unknown>>;
  } else if (type === 'acquisitions') {
    rows = db
      .prepare(
        `SELECT a.request_number as No_Pengadaan, a.title_summary as Ringkasan,
                COALESCE(s.name, '-') as Pemasok, a.total_estimated_cost as Estimasi_Biaya,
                a.status as Status, date(a.created_at) as Tanggal_Pengajuan
         FROM acquisitions a
         LEFT JOIN suppliers s ON s.id = a.supplier_id
         WHERE date(a.created_at) BETWEEN ? AND ?
         ORDER BY a.id DESC`
      )
      .all(fromDate, toDate) as Array<Record<string, unknown>>;
  } else if (type === 'inventory' || type === 'lost_damaged') {
    const condClause =
      type === 'lost_damaged' ? "AND (bc.condition IN ('Rusak Ringan', 'Rusak Berat', 'Hilang') OR bc.status IN ('Hilang', 'Perbaikan'))" : '';
    rows = db
      .prepare(
        `SELECT bc.inventory_code as Kode_Inventaris, bc.barcode as Barcode, b.title as Judul,
                COALESCE(s.code, '-') as Rak, bc.condition as Kondisi, bc.status as Status, bc.price as Nilai_Buku
         FROM book_copies bc
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN shelves s ON s.id = bc.shelf_id
         WHERE bc.archived_at IS NULL ${condClause}
         ORDER BY bc.inventory_code ASC`
      )
      .all() as Array<Record<string, unknown>>;
  }

  const categories = db.prepare('SELECT id, name FROM categories ORDER BY name').all();
  return NextResponse.json({ type, rows, categories });
}
