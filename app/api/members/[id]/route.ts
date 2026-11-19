import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('members.read');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const memberId = Number(id);
  const db = getDb();

  const member = db
    .prepare(
      `SELECT m.*, mt.name as membership_type_name, mt.max_loans, mt.loan_duration_days, mt.max_renewals, mt.daily_fine_rate
       FROM members m
       JOIN membership_types mt ON mt.id = m.membership_type_id
       WHERE m.id = ?`
    )
    .get(memberId);

  if (!member) {
    return NextResponse.json({ error: 'Anggota tidak ditemukan.' }, { status: 404 });
  }

  const loans = db
    .prepare(
      `SELECT l.id, l.loan_number, l.loan_date, l.due_date, l.status,
              b.title as book_title, bc.inventory_code, li.status as item_status, li.returned_at
       FROM loans l
       JOIN loan_items li ON li.loan_id = l.id
       JOIN book_copies bc ON bc.id = li.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE l.member_id = ?
       ORDER BY l.loan_date DESC, li.id DESC
       LIMIT 30`
    )
    .all(memberId);

  const returns = db
    .prepare(
      `SELECT r.return_number, r.returned_at, r.condition, r.status, r.overdue_days, r.fine_amount,
              b.title as book_title, bc.inventory_code
       FROM returns r
       JOIN loans l ON l.id = r.loan_id
       JOIN book_copies bc ON bc.id = r.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE l.member_id = ?
       ORDER BY r.returned_at DESC
       LIMIT 30`
    )
    .all(memberId);

  const fines = db
    .prepare(
      `SELECT * FROM fines WHERE member_id = ? ORDER BY created_at DESC LIMIT 30`
    )
    .all(memberId);

  return NextResponse.json({ member, loans, returns, fines });
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('members.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const memberId = Number(id);
  const body = await req.json();
  const db = getDb();

  const before = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as
    | { id: number; expires_at: string; status: string }
    | undefined;
  if (!before) {
    return NextResponse.json({ error: 'Anggota tidak ditemukan.' }, { status: 404 });
  }

  if (body.action === 'block' || body.action === 'unblock' || body.action === 'deactivate') {
    const blockGuard = await requirePermission('members.block');
    if (blockGuard.errorResponse) return blockGuard.errorResponse;

    const newStatus =
      body.action === 'block' ? 'Diblokir' : body.action === 'deactivate' ? 'Nonaktif' : 'Aktif';
    const blockReason = body.action === 'block' ? String(body.reason || 'Diblokir oleh petugas') : '';

    db.transaction(() => {
      db.prepare(
        `UPDATE members SET status = ?, block_reason = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newStatus, blockReason, memberId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: `MEMBER_${body.action.toUpperCase()}`,
        entityType: 'members',
        entityId: memberId,
        before,
        after: { status: newStatus, blockReason },
      });
    })();

    return NextResponse.json({ ok: true, status: newStatus });
  }

  if (body.action === 'extend') {
    const days = Math.max(30, Number(body.days || 365));
    const baseDate =
      before.expires_at > formatIsoDate(new Date()) ? before.expires_at : formatIsoDate(new Date());
    const newExpiry = addDaysIso(baseDate, days);
    // Preserve Diblokir status so extending expiry does not silently lift an administrative block
    const nextStatus = before.status === 'Diblokir' ? 'Diblokir' : 'Aktif';

    db.transaction(() => {
      db.prepare(
        `UPDATE members SET expires_at = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newExpiry, nextStatus, memberId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'MEMBER_EXTEND',
        entityType: 'members',
        entityId: memberId,
        before: { expires_at: before.expires_at, status: before.status },
        after: { expires_at: newExpiry, status: nextStatus },
      });
    })();

    return NextResponse.json({ ok: true, expiresAt: newExpiry, status: nextStatus });
  }

  if (body.action === 'archive') {
    const activeLoans = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM loan_items li JOIN loans l ON l.id = li.loan_id
           WHERE l.member_id = ? AND li.returned_at IS NULL`
        )
        .get(memberId) as { c: number }
    ).c;

    if (activeLoans > 0) {
      return NextResponse.json(
        { error: 'Anggota tidak dapat diarsipkan karena masih memiliki pinjaman aktif.' },
        { status: 409 }
      );
    }

    db.transaction(() => {
      db.prepare("UPDATE members SET status = 'Nonaktif', archived_at = datetime('now') WHERE id = ?").run(
        memberId
      );
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'MEMBER_ARCHIVE',
        entityType: 'members',
        entityId: memberId,
      });
    })();
    return NextResponse.json({ ok: true });
  }

  const fullName = String(body.fullName || '').trim();
  if (!fullName) {
    return NextResponse.json({ error: 'Nama lengkap wajib diisi.' }, { status: 400 });
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE members
       SET full_name = ?, membership_type_id = ?, identity_number = ?, gender = ?,
           unit_or_class = ?, address = ?, phone = ?, email = ?, expires_at = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      fullName,
      Number(body.membershipTypeId || 1),
      String(body.identityNumber || ''),
      String(body.gender || 'Tidak Disebutkan'),
      String(body.unitOrClass || ''),
      String(body.address || ''),
      String(body.phone || ''),
      String(body.email || ''),
      String(body.expiresAt || before.expires_at),
      memberId
    );

    logAudit(db, {
      userId: guard.user.id,
      userName: guard.user.fullName,
      action: 'MEMBER_UPDATE',
      entityType: 'members',
      entityId: memberId,
      before,
      after: { fullName },
    });
  })();

  return NextResponse.json({ ok: true });
}
