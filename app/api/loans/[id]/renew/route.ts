import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  addDaysIso,
  formatIsoDate,
  validateRenewalEligibility,
  type MemberStatus,
} from '@/lib/domain/library-rules';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('loans.read');
  if (guard.errorResponse) return guard.errorResponse;

  // Staff with loans.write OR Anggota renewing own loan
  const canRenewAny = guard.user.permissions.includes('loans.write') || guard.user.permissions.includes('*');

  const { id } = await context.params;
  const loanId = Number(id);
  const body = await req.json();
  const loanItemId = Number(body.loanItemId);
  const reason = String(body.reason || 'Perpanjangan masa pinjam');

  if (!loanItemId) {
    return NextResponse.json({ error: 'Item buku yang akan diperpanjang wajib dipilih.' }, { status: 400 });
  }

  const db = getDb();
  const settings = getSettingsMap(db);
  const allowOverdueRenewal = settings.allow_overdue_renewal === 'true';
  const today = formatIsoDate(new Date());

  try {
    const newDueDate = db.transaction(() => {
      const row = db
        .prepare(
          `SELECT li.id as item_id, li.due_date, li.returned_at, li.renewal_count,
                  bc.book_id, bc.inventory_code,
                  l.id as loan_id, l.loan_number, l.member_id,
                  m.status as member_status, m.expires_at as member_expires_at,
                  mt.max_renewals, mt.loan_duration_days
           FROM loan_items li
           JOIN loans l ON l.id = li.loan_id
           JOIN book_copies bc ON bc.id = li.copy_id
           JOIN members m ON m.id = l.member_id
           JOIN membership_types mt ON mt.id = m.membership_type_id
           WHERE l.id = ? AND li.id = ?`
        )
        .get(loanId, loanItemId) as
        | {
            item_id: number;
            due_date: string;
            returned_at: string | null;
            renewal_count: number;
            book_id: number;
            inventory_code: string;
            loan_id: number;
            loan_number: string;
            member_id: number;
            member_status: MemberStatus;
            member_expires_at: string;
            max_renewals: number;
            loan_duration_days: number;
          }
        | undefined;

      if (!row) {
        throw new Error('Item peminjaman tidak ditemukan.');
      }
      if (!canRenewAny && guard.user.memberId !== row.member_id) {
        throw new Error('Anda hanya dapat memperpanjang peminjaman milik sendiri.');
      }
      if (row.returned_at) {
        throw new Error('Buku ini sudah dikembalikan.');
      }

      const activeQueue = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM reservations
             WHERE book_id = ? AND status IN ('Menunggu', 'Tersedia')`
          )
          .get(row.book_id) as { c: number }
      ).c;

      const check = validateRenewalEligibility({
        memberStatus: row.member_status,
        memberExpiresAt: row.member_expires_at,
        todayStr: today,
        currentRenewals: row.renewal_count,
        maxRenewals: row.max_renewals,
        dueDateStr: row.due_date,
        hasActiveReservationQueue: activeQueue > 0,
        allowOverdueRenewal,
      });

      if (!check.ok) {
        throw new Error(check.reason);
      }

      const baseDate = row.due_date > today ? row.due_date : today;
      const computedDue = addDaysIso(baseDate, row.loan_duration_days);

      db.prepare(
        `UPDATE loan_items SET due_date = ?, renewal_count = renewal_count + 1, status = 'Dipinjam' WHERE id = ?`
      ).run(computedDue, row.item_id);

      const itemSummary = db
        .prepare(
          `SELECT
             MAX(CASE WHEN returned_at IS NULL THEN due_date END) as max_due_date,
             SUM(CASE WHEN returned_at IS NULL AND due_date < ? THEN 1 ELSE 0 END) as overdue_count,
             SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) as returned_count
           FROM loan_items WHERE loan_id = ?`
        )
        .get(today, row.loan_id) as {
        max_due_date: string | null;
        overdue_count: number;
        returned_count: number;
      };

      const nextLoanStatus =
        itemSummary.overdue_count > 0
          ? 'Terlambat'
          : itemSummary.returned_count > 0
          ? 'Sebagian Kembali'
          : 'Aktif';

      db.prepare(
        `UPDATE loans SET due_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(itemSummary.max_due_date || computedDue, nextLoanStatus, row.loan_id);

      db.prepare(
        `INSERT INTO loan_renewals (loan_item_id, renewed_by_user_id, old_due_date, new_due_date, reason)
         VALUES (?, ?, ?, ?, ?)`
      ).run(row.item_id, guard.user.id, row.due_date, computedDue, reason);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'LOAN_RENEW',
        entityType: 'loans',
        entityId: row.loan_number,
        before: { dueDate: row.due_date, renewalCount: row.renewal_count },
        after: { dueDate: computedDue, renewalCount: row.renewal_count + 1 },
      });

      return computedDue;
    })();

    return NextResponse.json({ ok: true, newDueDate });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memperpanjang peminjaman.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
