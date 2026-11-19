import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  calculateDueDate,
  formatIsoDate,
  validateLoanEligibility,
  type CopyStatus,
  type MemberStatus,
} from '@/lib/domain/library-rules';
import { extractCirculationPolicy } from '@/lib/domain/settings-backup-rules';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('loans.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const today = formatIsoDate(new Date());
  db.prepare(
    `UPDATE loans SET status = 'Terlambat', updated_at = datetime('now')
     WHERE status = 'Aktif' AND due_date < ?`
  ).run(today);
  db.prepare(
    `UPDATE loan_items SET status = 'Terlambat'
     WHERE status = 'Dipinjam' AND due_date < ?`
  ).run(today);

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const status = sp.get('status') || '';

  let where = 'WHERE 1=1';
  const params: Array<string | number> = [];

  const policy = extractCirculationPolicy(getSettingsMap(db));

  // Scope Anggota strictly to own loans
  if (guard.user.roleSlug === 'anggota') {
    if (!guard.user.memberId) {
      return NextResponse.json({
        loans: [],
        policy: {
          blockOnUnpaidFinesLimit: policy.blockOnUnpaidFinesLimit,
          allowOverdueRenewal: policy.allowOverdueRenewal,
        },
      });
    }
    where += ' AND l.member_id = ?';
    params.push(guard.user.memberId);
  }

  if (q) {
    const like = `%${q}%`;
    where += ` AND (l.loan_number LIKE ? OR m.full_name LIKE ? OR m.member_code LIKE ?
      OR EXISTS (SELECT 1 FROM loan_items li2 JOIN book_copies bc2 ON bc2.id = li2.copy_id JOIN books b2 ON b2.id = bc2.book_id
                 WHERE li2.loan_id = l.id AND (b2.title LIKE ? OR bc2.inventory_code LIKE ? OR bc2.barcode LIKE ?)))`;
    params.push(like, like, like, like, like, like);
  }
  if (status) {
    where += ' AND l.status = ?';
    params.push(status);
  }

  const loans = db
    .prepare(
      `SELECT l.*, m.member_code, m.full_name as member_name, m.status as member_status,
              mt.name as membership_type_name, mt.max_renewals,
              u.full_name as staff_name
       FROM loans l
       JOIN members m ON m.id = l.member_id
       JOIN membership_types mt ON mt.id = m.membership_type_id
       LEFT JOIN users u ON u.id = l.staff_user_id
       ${where}
       ORDER BY l.id DESC
       LIMIT 100`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const itemsStmt = db.prepare(
    `SELECT li.*, bc.inventory_code, bc.barcode, bc.condition,
            b.id as book_id, b.title as book_title, b.isbn
     FROM loan_items li
     JOIN book_copies bc ON bc.id = li.copy_id
     JOIN books b ON b.id = bc.book_id
     WHERE li.loan_id = ?`
  );

  const enriched = loans.map((loan) => ({
    ...loan,
    items: itemsStmt.all(loan.id),
  }));

  return NextResponse.json({
    loans: enriched,
    policy: {
      blockOnUnpaidFinesLimit: policy.blockOnUnpaidFinesLimit,
      allowOverdueRenewal: policy.allowOverdueRenewal,
    },
  });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('loans.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const memberId = Number(body.memberId);
    const copyIds: number[] = Array.isArray(body.copyIds)
      ? Array.from(new Set(body.copyIds.map((c: unknown) => Number(c)).filter((n: number) => n > 0)))
      : [];
    const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey).trim() : null;
    const notes = String(body.notes || '');

    if (!memberId || copyIds.length === 0) {
      return NextResponse.json(
        { error: 'Pilih anggota dan minimal satu eksemplar buku yang valid.' },
        { status: 400 }
      );
    }

    const db = getDb();
    if (idempotencyKey) {
      const existing = db
        .prepare('SELECT id, loan_number, due_date FROM loans WHERE idempotency_key = ?')
        .get(idempotencyKey) as { id: number; loan_number: string; due_date: string } | undefined;
      if (existing) {
        return NextResponse.json({
          id: existing.id,
          loanNumber: existing.loan_number,
          dueDate: existing.due_date,
          deduplicated: true,
        });
      }
    }

    const policy = extractCirculationPolicy(getSettingsMap(db));
    const fineBlockLimit = policy.blockOnUnpaidFinesLimit;
    const today = formatIsoDate(new Date());

    const result = db.transaction(() => {
      const member = db
        .prepare(
          `SELECT m.*, mt.max_loans, mt.loan_duration_days
           FROM members m
           JOIN membership_types mt ON mt.id = m.membership_type_id
           WHERE m.id = ? AND m.archived_at IS NULL`
        )
        .get(memberId) as
        | {
            id: number;
            member_code: string;
            full_name: string;
            status: MemberStatus;
            expires_at: string;
            max_loans: number;
            loan_duration_days: number;
          }
        | undefined;

      if (!member) {
        throw new Error('Anggota tidak ditemukan atau telah diarsipkan.');
      }

      const activeLoansCount = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM loan_items li
             JOIN loans l ON l.id = li.loan_id
             WHERE l.member_id = ? AND li.returned_at IS NULL`
          )
          .get(memberId) as { c: number }
      ).c;

      const unpaidFinesTotal = (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount - paid_amount - waived_amount), 0) as total
             FROM fines WHERE member_id = ? AND status IN ('Belum Lunas', 'Sebagian')`
          )
          .get(memberId) as { total: number }
      ).total;

      const reservedCopyIds = new Set<number>();

      for (const copyId of copyIds) {
        const copy = db
          .prepare(
            `SELECT bc.id, bc.inventory_code, bc.status, bc.archived_at,
                    b.title, b.is_reference_only, b.read_in_place_only
             FROM book_copies bc
             JOIN books b ON b.id = bc.book_id
             WHERE bc.id = ?`
          )
          .get(copyId) as
          | {
              id: number;
              inventory_code: string;
              status: CopyStatus;
              archived_at: string | null;
              title: string;
              is_reference_only: number;
              read_in_place_only: number;
            }
          | undefined;

        if (!copy || copy.archived_at) {
          throw new Error(`Eksemplar #${copyId} tidak ditemukan atau telah diarsipkan.`);
        }

        let reservedForMember = false;
        if (copy.status === 'Direservasi') {
          const matchingRes = db
            .prepare(
              `SELECT id FROM reservations
               WHERE member_id = ? AND copy_id = ? AND status = 'Tersedia'`
            )
            .get(memberId, copyId) as { id: number } | undefined;
          if (matchingRes) {
            reservedForMember = true;
            reservedCopyIds.add(copyId);
          }
        }

        const check = validateLoanEligibility({
          memberStatus: member.status,
          memberExpiresAt: member.expires_at,
          activeLoansCount,
          maxLoans: member.max_loans,
          requestedCount: copyIds.length,
          copyStatus: copy.status,
          isReferenceOnly: copy.is_reference_only === 1,
          readInPlaceOnly: copy.read_in_place_only === 1,
          todayStr: today,
          unpaidFinesTotal,
          blockOnUnpaidFinesLimit: fineBlockLimit,
          reservedForMember,
        });

        if (!check.ok) {
          throw new Error(`${copy.title} (${copy.inventory_code}): ${check.reason}`);
        }
      }

      const dueDate = body.dueDate
        ? String(body.dueDate)
        : calculateDueDate(today, member.loan_duration_days);
      const maxLoanId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM loans').get() as { m: number }
      ).m;
      const loanNumber = `PJM-2026-${String(maxLoanId + 1).padStart(4, '0')}`;

      const loanId = Number(
        db
          .prepare(
            `INSERT INTO loans (loan_number, idempotency_key, member_id, staff_user_id, loan_date, due_date, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, 'Aktif', ?)`
          )
          .run(loanNumber, idempotencyKey, memberId, guard.user.id, today, dueDate, notes)
          .lastInsertRowid
      );

      const insItem = db.prepare(
        `INSERT INTO loan_items (loan_id, copy_id, due_date, status) VALUES (?, ?, ?, 'Dipinjam')`
      );
      const updCopyAvailable = db.prepare(
        `UPDATE book_copies SET status = 'Dipinjam', updated_at = datetime('now') WHERE id = ? AND status = 'Tersedia'`
      );
      const updCopyReserved = db.prepare(
        `UPDATE book_copies SET status = 'Dipinjam', updated_at = datetime('now') WHERE id = ? AND status = 'Direservasi'`
      );

      for (const copyId of copyIds) {
        const res = reservedCopyIds.has(copyId)
          ? updCopyReserved.run(copyId)
          : updCopyAvailable.run(copyId);
        if (res.changes !== 1) {
          throw new Error(`Eksemplar #${copyId} baru saja diproses oleh transaksi lain.`);
        }
        insItem.run(loanId, copyId, dueDate);

        // Fulfill matching reservation if member had one marked Tersedia
        db.prepare(
          `UPDATE reservations SET status = 'Diambil'
           WHERE member_id = ? AND copy_id = ? AND status = 'Tersedia'`
        ).run(memberId, copyId);
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'LOAN_CREATE',
        entityType: 'loans',
        entityId: loanNumber,
        after: { memberId, memberCode: member.member_code, copyIds, dueDate },
      });

      return { id: loanId, loanNumber, dueDate };
    })();

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memproses peminjaman.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
