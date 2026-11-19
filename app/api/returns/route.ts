import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  addDaysIso,
  calculateFineAmount,
  calculateOverdueDays,
  formatIsoDate,
  type CopyCondition,
} from '@/lib/domain/library-rules';
import { extractCirculationPolicy } from '@/lib/domain/settings-backup-rules';

export async function GET() {
  const guard = await requirePermission('returns.write');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const settings = getSettingsMap(db);
  const returns = db
    .prepare(
      `SELECT r.*, l.loan_number, m.full_name as member_name, m.member_code,
              b.title as book_title, bc.inventory_code, bc.barcode,
              u.full_name as staff_name
       FROM returns r
       JOIN loans l ON l.id = r.loan_id
       JOIN members m ON m.id = l.member_id
       JOIN book_copies bc ON bc.id = r.copy_id
       JOIN books b ON b.id = bc.book_id
       LEFT JOIN users u ON u.id = r.staff_user_id
       ORDER BY r.id DESC
       LIMIT 100`
    )
    .all();

  const activeItems = db
    .prepare(
      `SELECT li.id as loan_item_id, li.loan_id, li.copy_id, li.due_date, li.status as item_status,
              l.loan_number, l.loan_date,
              m.id as member_id, m.member_code, m.full_name as member_name,
              mt.daily_fine_rate, mt.max_fine_cap,
              b.id as book_id, b.title as book_title, b.price as book_price,
              bc.inventory_code, bc.barcode, bc.price as copy_price
       FROM loan_items li
       JOIN loans l ON l.id = li.loan_id
       JOIN members m ON m.id = l.member_id
       JOIN membership_types mt ON mt.id = m.membership_type_id
       JOIN book_copies bc ON bc.id = li.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE li.returned_at IS NULL
       ORDER BY li.due_date ASC`
    )
    .all();

  const policy = extractCirculationPolicy(settings);

  return NextResponse.json({
    returns,
    activeItems,
    policy: {
      gracePeriodDays: policy.gracePeriodDays,
      damageFeePercent: policy.damageFeePercent,
      lostFeePercent: policy.lostFeePercent,
      reservationExpiryDays: policy.reservationExpiryDays,
    },
  });
}

const VALID_CONDITIONS: CopyCondition[] = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'];

export async function POST(req: NextRequest) {
  const guard = await requirePermission('returns.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const loanItemId = Number(body.loanItemId);
    const rawCondition = String(body.condition || 'Baik') as CopyCondition;
    const notes = String(body.notes || '');

    if (!loanItemId) {
      return NextResponse.json({ error: 'Item pinjaman wajib dipilih.' }, { status: 400 });
    }
    if (!VALID_CONDITIONS.includes(rawCondition)) {
      return NextResponse.json({ error: 'Kondisi buku pengembalian tidak valid.' }, { status: 400 });
    }
    const condition: CopyCondition = rawCondition;

    const db = getDb();
    const policy = extractCirculationPolicy(getSettingsMap(db));
    const graceDays = policy.gracePeriodDays;
    const damageFeePercent = policy.damageFeePercent;
    const lostFeePercent = policy.lostFeePercent;
    const reservationExpiryDays = policy.reservationExpiryDays;
    const today = formatIsoDate(new Date());

    const result = db.transaction(() => {
      const item = db
        .prepare(
          `SELECT li.*, l.loan_number, l.member_id,
                  m.full_name as member_name,
                  mt.daily_fine_rate, mt.max_fine_cap,
                  bc.book_id, bc.inventory_code, bc.price as copy_price,
                  b.title as book_title, b.price as book_price
           FROM loan_items li
           JOIN loans l ON l.id = li.loan_id
           JOIN members m ON m.id = l.member_id
           JOIN membership_types mt ON mt.id = m.membership_type_id
           JOIN book_copies bc ON bc.id = li.copy_id
           JOIN books b ON b.id = bc.book_id
           WHERE li.id = ?`
        )
        .get(loanItemId) as
        | {
            id: number;
            loan_id: number;
            copy_id: number;
            due_date: string;
            returned_at: string | null;
            loan_number: string;
            member_id: number;
            member_name: string;
            daily_fine_rate: number;
            max_fine_cap: number;
            book_id: number;
            inventory_code: string;
            copy_price: number;
            book_title: string;
            book_price: number;
          }
        | undefined;

      if (!item) throw new Error('Item peminjaman tidak ditemukan.');
      if (item.returned_at) throw new Error('Eksemplar ini sudah dikembalikan sebelumnya.');

      const overdueDays = calculateOverdueDays(item.due_date, today, graceDays);
      const bookPrice = item.copy_price || item.book_price || 100000;
      const fineCalc = calculateFineAmount({
        overdueDays,
        dailyRate: item.daily_fine_rate,
        maxCap: item.max_fine_cap,
        condition,
        bookPrice,
        damageFeePercent,
        lostFeePercent,
      });

      const returnStatus =
        condition === 'Hilang'
          ? 'Hilang'
          : condition === 'Rusak Berat' || condition === 'Rusak Ringan'
          ? 'Rusak'
          : overdueDays > 0
          ? 'Terlambat'
          : 'Tepat Waktu';

      const maxRetId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM returns').get() as { m: number }
      ).m;
      const returnNumber = `KMB-2026-${String(maxRetId + 1).padStart(4, '0')}`;

      const returnId = Number(
        db
          .prepare(
            `INSERT INTO returns (return_number, loan_id, loan_item_id, copy_id, staff_user_id, returned_at, condition, status, overdue_days, fine_amount, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            returnNumber,
            item.loan_id,
            item.id,
            item.copy_id,
            guard.user.id,
            today,
            condition,
            returnStatus,
            overdueDays,
            fineCalc.totalFine,
            notes
          ).lastInsertRowid
      );

      const loanItemStatus =
        condition === 'Hilang'
          ? 'Hilang'
          : condition === 'Rusak Berat'
          ? 'Rusak'
          : overdueDays > 0
          ? 'Terlambat'
          : 'Dikembalikan';

      db.prepare(
        `UPDATE loan_items SET returned_at = ?, status = ?, return_condition = ? WHERE id = ?`
      ).run(today, loanItemStatus, condition, item.id);

      // Update loan status depending on remaining unreturned items
      const remainingItems = (
        db
          .prepare('SELECT COUNT(*) as c FROM loan_items WHERE loan_id = ? AND returned_at IS NULL')
          .get(item.loan_id) as { c: number }
      ).c;

      db.prepare(
        `UPDATE loans SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(remainingItems === 0 ? 'Selesai' : 'Sebagian Kembali', item.loan_id);

      // Determine new copy status & check waiting reservation queue
      let newCopyStatus = 'Tersedia';
      if (condition === 'Hilang') {
        newCopyStatus = 'Hilang';
      } else if (condition === 'Rusak Berat') {
        newCopyStatus = 'Perbaikan';
      } else {
        const nextRes = db
          .prepare(
            `SELECT * FROM reservations
             WHERE book_id = ? AND status = 'Menunggu'
             ORDER BY queue_position ASC, reserved_at ASC
             LIMIT 1`
          )
          .get(item.book_id) as
          | { id: number; member_id: number; reservation_number: string }
          | undefined;

        if (nextRes) {
          newCopyStatus = 'Direservasi';
          const expiresAt = addDaysIso(today, reservationExpiryDays);
          db.prepare(
            `UPDATE reservations
             SET status = 'Tersedia', copy_id = ?, notified_at = datetime('now'), expires_at = ?
             WHERE id = ?`
          ).run(item.copy_id, expiresAt, nextRes.id);

          db.prepare(
            `INSERT INTO notifications (member_id, type, title, message, link)
             VALUES (?, 'success', 'Buku Reservasi Tersedia', ?, '/reservations')`
          ).run(
            nextRes.member_id,
            `Buku "${item.book_title}" (${nextRes.reservation_number}) telah tersedia dan ditahan hingga ${expiresAt}.`
          );
        }
      }

      db.prepare(
        `UPDATE book_copies SET status = ?, condition = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newCopyStatus, condition, item.copy_id);

      // Create fine if totalFine > 0 (prevent duplicate fine for same return_id)
      let fineNumber: string | null = null;
      if (fineCalc.totalFine > 0) {
        const maxFineId = (
          db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM fines').get() as { m: number }
        ).m;
        fineNumber = `DND-2026-${String(maxFineId + 1).padStart(4, '0')}`;
        const fineType =
          condition === 'Hilang'
            ? 'Kehilangan'
            : condition === 'Rusak Berat' || condition === 'Rusak Ringan'
            ? 'Kerusakan'
            : 'Keterlambatan';

        const reasonParts: string[] = [];
        if (overdueDays > 0) reasonParts.push(`Terlambat ${overdueDays} hari`);
        if (fineCalc.damageFine > 0) reasonParts.push(`Kondisi ${condition}`);

        db.prepare(
          `INSERT INTO fines (fine_number, member_id, loan_id, return_id, fine_type, amount, status, reason, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'Belum Lunas', ?, ?)`
        ).run(
          fineNumber,
          item.member_id,
          item.loan_id,
          returnId,
          fineType,
          fineCalc.totalFine,
          `${reasonParts.join(' · ')} (${returnNumber})`,
          guard.user.id
        );
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'BOOK_RETURN',
        entityType: 'returns',
        entityId: returnNumber,
        after: {
          loanNumber: item.loan_number,
          inventoryCode: item.inventory_code,
          condition,
          overdueDays,
          totalFine: fineCalc.totalFine,
          newCopyStatus,
        },
      });

      return {
        returnNumber,
        returnStatus,
        overdueDays,
        totalFine: fineCalc.totalFine,
        fineNumber,
        newCopyStatus,
      };
    })();

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memproses pengembalian.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
