import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import { extractCirculationPolicy } from '@/lib/domain/settings-backup-rules';

export async function GET() {
  const guard = await requirePermission('notifications.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  let where = 'WHERE 1=1';
  const params: number[] = [];

  if (guard.user.roleSlug === 'anggota') {
    where += ' AND (user_id = ? OR member_id = ?)';
    params.push(guard.user.id, guard.user.memberId || -1);
  } else {
    where += ' AND (user_id = ? OR (user_id IS NULL AND member_id IS NULL))';
    params.push(guard.user.id);
  }

  const notifications = db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY is_read ASC, id DESC LIMIT 60`)
    .all(...params);

  return NextResponse.json({ notifications });
}

export async function PATCH(req: NextRequest) {
  const guard = await requirePermission('notifications.read');
  if (guard.errorResponse) return guard.errorResponse;

  const body = await req.json();
  const db = getDb();

  if (body.action === 'mark_all_read') {
    if (guard.user.roleSlug === 'anggota') {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR member_id = ?').run(
        guard.user.id,
        guard.user.memberId || -1
      );
    } else {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR (user_id IS NULL AND member_id IS NULL)').run(
        guard.user.id
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'scan_alerts') {
    if (guard.user.roleSlug === 'anggota') {
      return NextResponse.json(
        { error: 'Hanya petugas yang dapat memindai pengingat sistem.' },
        { status: 403 }
      );
    }
    const policy = extractCirculationPolicy(getSettingsMap(db));
    const today = formatIsoDate(new Date());
    const reminderDays = policy.autoReminderDaysBeforeDue;
    const dueSoonLimit = addDaysIso(today, reminderDays);

    let generated = 0;
    db.transaction(() => {
      // Check overdue loans not yet notified today
      const overdue = db
        .prepare(
          `SELECT l.loan_number, l.due_date, m.full_name
           FROM loans l JOIN members m ON m.id = l.member_id
           WHERE l.status IN ('Aktif', 'Terlambat') AND l.due_date < ?`
        )
        .all(today) as Array<{ loan_number: string; due_date: string; full_name: string }>;

      for (const o of overdue) {
        const exists = db
          .prepare('SELECT id FROM notifications WHERE title = ? AND message LIKE ?')
          .get('Peringatan Keterlambatan', `%${o.loan_number}%`);
        if (!exists) {
          db.prepare(
            `INSERT INTO notifications (type, title, message, link) VALUES ('warning', 'Peringatan Keterlambatan', ?, '/returns')`
          ).run(`Transaksi ${o.loan_number} (${o.full_name}) telah melewati jatuh tempo (${o.due_date}).`);
          generated++;
        }
      }

      // Check due soon
      const dueSoon = db
        .prepare(
          `SELECT l.loan_number, l.due_date, m.full_name, m.id as member_id
           FROM loans l JOIN members m ON m.id = l.member_id
           WHERE l.status = 'Aktif' AND l.due_date BETWEEN ? AND ?`
        )
        .all(today, dueSoonLimit) as Array<{
        loan_number: string;
        due_date: string;
        full_name: string;
        member_id: number;
      }>;

      for (const ds of dueSoon) {
        const exists = db
          .prepare('SELECT id FROM notifications WHERE title = ? AND message LIKE ?')
          .get('Mendekati Jatuh Tempo', `%${ds.loan_number}%`);
        if (!exists) {
          db.prepare(
            `INSERT INTO notifications (member_id, type, title, message, link) VALUES (?, 'info', 'Mendekati Jatuh Tempo', ?, '/loans')`
          ).run(ds.member_id, `Pinjaman ${ds.loan_number} jatuh tempo pada ${ds.due_date}.`);
          generated++;
        }
      }
    })();

    return NextResponse.json({ ok: true, generated });
  }

  if (body.id) {
    const notifId = Number(body.id);
    if (guard.user.roleSlug === 'anggota') {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR member_id = ?)').run(
        notifId,
        guard.user.id,
        guard.user.memberId || -1
      );
    } else {
      db.prepare(
        'UPDATE notifications SET is_read = 1 WHERE id = ? AND (user_id = ? OR (user_id IS NULL AND member_id IS NULL))'
      ).run(notifId, guard.user.id);
    }
  }

  return NextResponse.json({ ok: true });
}
