import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { validatePaymentAmount } from '@/lib/domain/library-rules';

export async function GET() {
  const guard = await requirePermission('fines.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  let where = 'WHERE 1=1';
  const params: number[] = [];

  if (guard.user.roleSlug === 'anggota') {
    if (!guard.user.memberId) return NextResponse.json({ fines: [], payments: [] });
    where += ' AND f.member_id = ?';
    params.push(guard.user.memberId);
  }

  const fines = db
    .prepare(
      `SELECT f.*, m.member_code, m.full_name as member_name, l.loan_number
       FROM fines f
       JOIN members m ON m.id = f.member_id
       LEFT JOIN loans l ON l.id = f.loan_id
       ${where}
       ORDER BY f.id DESC`
    )
    .all(...params);

  const payments = db
    .prepare(
      `SELECT p.*, f.fine_number, m.member_code, m.full_name as member_name, u.full_name as received_by_name
       FROM payments p
       JOIN fines f ON f.id = p.fine_id
       JOIN members m ON m.id = p.member_id
       LEFT JOIN users u ON u.id = p.received_by_user_id
       ${guard.user.roleSlug === 'anggota' ? 'WHERE p.member_id = ?' : ''}
       ORDER BY p.id DESC
       LIMIT 100`
    )
    .all(...params);

  return NextResponse.json({ fines, payments });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = String(body.action || 'pay');
  const db = getDb();

  if (action === 'waive') {
    const guard = await requirePermission('fines.waive');
    if (guard.errorResponse) return guard.errorResponse;

    const fineId = Number(body.fineId);
    const reason = String(body.reason || 'Pengecualian oleh pejabat berwenang');

    const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(fineId) as
      | { id: number; fine_number: string; amount: number; paid_amount: number; waived_amount: number }
      | undefined;
    if (!fine) return NextResponse.json({ error: 'Data denda tidak ditemukan.' }, { status: 404 });

    const remaining = Math.max(0, fine.amount - fine.paid_amount - fine.waived_amount);
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Denda sudah lunas atau dibebaskan.' }, { status: 400 });
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE fines
         SET waived_amount = waived_amount + ?, status = 'Dibebaskan',
             waived_by_user_id = ?, reason = reason || ' | Dibebaskan: ' || ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(remaining, guard.user.id, reason, fineId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'FINE_WAIVE',
        entityType: 'fines',
        entityId: fine.fine_number,
        before: { remaining },
        after: { waived: remaining, reason },
      });
    })();

    return NextResponse.json({ ok: true });
  }

  // Pay fine
  const guard = await requirePermission('fines.pay');
  if (guard.errorResponse) return guard.errorResponse;

  const fineId = Number(body.fineId);
  const amount = Number(body.amount);
  const method = String(body.method || 'Tunai');
  const notes = String(body.notes || '');

  const settings = getSettingsMap(db);
  const allowPartial = settings.allow_partial_fine_payment !== 'false';

  try {
    const paymentResult = db.transaction(() => {
      const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(fineId) as
        | {
            id: number;
            fine_number: string;
            member_id: number;
            amount: number;
            paid_amount: number;
            waived_amount: number;
          }
        | undefined;
      if (!fine) throw new Error('Data denda tidak ditemukan.');

      const check = validatePaymentAmount({
        fineAmount: fine.amount,
        paidAmount: fine.paid_amount,
        waivedAmount: fine.waived_amount,
        paymentAmount: amount,
        allowPartialPayment: allowPartial,
      });

      if (!check.ok || check.newPaidAmount === undefined || !check.newStatus) {
        throw new Error(check.reason || 'Nominal pembayaran tidak valid.');
      }

      const maxPayId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM payments').get() as { m: number }
      ).m;
      const paymentNumber = `BYR-2026-${String(maxPayId + 1).padStart(4, '0')}`;

      db.prepare(
        `INSERT INTO payments (payment_number, fine_id, member_id, amount, method, received_by_user_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(paymentNumber, fineId, fine.member_id, amount, method, guard.user.id, notes);

      db.prepare(
        `UPDATE fines SET paid_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(check.newPaidAmount, check.newStatus, fineId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'FINE_PAYMENT',
        entityType: 'payments',
        entityId: paymentNumber,
        before: { paidAmount: fine.paid_amount },
        after: { paidAmount: check.newPaidAmount, status: check.newStatus, method },
      });

      return { paymentNumber, newStatus: check.newStatus };
    })();

    return NextResponse.json(paymentResult, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memproses pembayaran denda.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
