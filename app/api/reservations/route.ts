import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import { extractCirculationPolicy } from '@/lib/domain/settings-backup-rules';

export async function GET() {
  const guard = await requirePermission('reservations.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const today = formatIsoDate(new Date());

  // Auto-release expired reservations
  db.transaction(() => {
    const expired = db
      .prepare(
        `SELECT id, copy_id FROM reservations WHERE status = 'Tersedia' AND expires_at IS NOT NULL AND expires_at < ?`
      )
      .all(today) as Array<{ id: number; copy_id: number | null }>;

    for (const ex of expired) {
      db.prepare("UPDATE reservations SET status = 'Kedaluwarsa' WHERE id = ?").run(ex.id);
      if (ex.copy_id) {
        db.prepare("UPDATE book_copies SET status = 'Tersedia' WHERE id = ? AND status = 'Direservasi'").run(
          ex.copy_id
        );
      }
    }
  })();

  let where = 'WHERE 1=1';
  const params: Array<number> = [];
  if (guard.user.roleSlug === 'anggota') {
    if (!guard.user.memberId) return NextResponse.json({ reservations: [] });
    where += ' AND r.member_id = ?';
    params.push(guard.user.memberId);
  }

  const reservations = db
    .prepare(
      `SELECT r.*, b.title as book_title, b.isbn,
              m.member_code, m.full_name as member_name,
              bc.inventory_code
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN members m ON m.id = r.member_id
       LEFT JOIN book_copies bc ON bc.id = r.copy_id
       ${where}
       ORDER BY CASE r.status WHEN 'Tersedia' THEN 1 WHEN 'Menunggu' THEN 2 ELSE 3 END, r.queue_position ASC, r.id DESC`
    )
    .all(...params);

  return NextResponse.json({ reservations });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('reservations.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const bookId = Number(body.bookId);
    const memberId =
      guard.user.roleSlug === 'anggota' && guard.user.memberId
        ? guard.user.memberId
        : Number(body.memberId);
    const notes = String(body.notes || '');

    if (!bookId || !memberId) {
      return NextResponse.json({ error: 'Buku dan anggota wajib dipilih.' }, { status: 400 });
    }

    const db = getDb();
    const resData = db.transaction(() => {
      const member = db
        .prepare(
          `SELECT m.id, m.status, m.full_name, mt.allow_reservation
           FROM members m JOIN membership_types mt ON mt.id = m.membership_type_id
           WHERE m.id = ? AND m.archived_at IS NULL`
        )
        .get(memberId) as
        | { id: number; status: string; full_name: string; allow_reservation: number }
        | undefined;

      if (!member) throw new Error('Anggota tidak ditemukan.');
      if (member.status !== 'Aktif') throw new Error('Hanya anggota aktif yang dapat mengajukan reservasi.');
      if (!member.allow_reservation) throw new Error('Jenis keanggotaan ini tidak mendukung reservasi.');

      const dup = db
        .prepare(
          `SELECT id FROM reservations
           WHERE book_id = ? AND member_id = ? AND status IN ('Menunggu', 'Tersedia')`
        )
        .get(bookId, memberId);
      if (dup) {
        throw new Error('Anggota sudah memiliki reservasi aktif untuk judul buku ini.');
      }

      const maxPos = (
        db
          .prepare(
            `SELECT COALESCE(MAX(queue_position), 0) as p FROM reservations
             WHERE book_id = ? AND status IN ('Menunggu', 'Tersedia')`
          )
          .get(bookId) as { p: number }
      ).p;

      const maxId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM reservations').get() as { m: number }
      ).m;
      const resNumber = `RSV-2026-${String(maxId + 1).padStart(4, '0')}`;

      const id = Number(
        db
          .prepare(
            `INSERT INTO reservations (reservation_number, book_id, member_id, queue_position, status, notes)
             VALUES (?, ?, ?, ?, 'Menunggu', ?)`
          )
          .run(resNumber, bookId, memberId, maxPos + 1, notes).lastInsertRowid
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'RESERVATION_CREATE',
        entityType: 'reservations',
        entityId: resNumber,
        after: { bookId, memberId, queuePosition: maxPos + 1 },
      });

      return { id, reservationNumber: resNumber, queuePosition: maxPos + 1 };
    })();

    return NextResponse.json(resData, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal membuat reservasi.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requirePermission('reservations.write');
  if (guard.errorResponse) return guard.errorResponse;

  const body = await req.json();
  const reservationId = Number(body.reservationId);
  const action = String(body.action || '');
  if (action !== 'cancel' && action !== 'pickup') {
    return NextResponse.json({ error: 'Aksi reservasi tidak valid.' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId) as
    | {
        id: number;
        book_id: number;
        member_id: number;
        copy_id: number | null;
        reservation_number: string;
        status: string;
      }
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Reservasi tidak ditemukan.' }, { status: 404 });
  }

  const isStaffCirculation =
    guard.user.permissions.includes('loans.write') || guard.user.permissions.includes('*');

  if (action === 'pickup' && !isStaffCirculation) {
    return NextResponse.json(
      { error: 'Hanya petugas sirkulasi yang dapat menandai pengambilan reservasi.' },
      { status: 403 }
    );
  }

  if (guard.user.roleSlug === 'anggota' && existing.member_id !== guard.user.memberId) {
    return NextResponse.json({ error: 'Tidak berhak mengubah reservasi anggota lain.' }, { status: 403 });
  }

  if (action === 'pickup' && existing.status !== 'Tersedia') {
    return NextResponse.json(
      { error: 'Hanya reservasi berstatus Tersedia yang dapat ditandai sudah diambil.' },
      { status: 400 }
    );
  }

  if (action === 'cancel' && existing.status !== 'Menunggu' && existing.status !== 'Tersedia') {
    return NextResponse.json(
      { error: 'Reservasi dengan status saat ini tidak dapat dibatalkan.' },
      { status: 400 }
    );
  }

  const policy = extractCirculationPolicy(getSettingsMap(db));
  const today = formatIsoDate(new Date());

  db.transaction(() => {
    if (action === 'cancel') {
      db.prepare("UPDATE reservations SET status = 'Dibatalkan' WHERE id = ?").run(reservationId);
      if (existing.copy_id) {
        const nextWaiting = db
          .prepare(
            `SELECT id, member_id, reservation_number FROM reservations
             WHERE book_id = ? AND status = 'Menunggu' AND id != ?
             ORDER BY queue_position ASC, reserved_at ASC
             LIMIT 1`
          )
          .get(existing.book_id, reservationId) as
          | { id: number; member_id: number; reservation_number: string }
          | undefined;

        if (nextWaiting) {
          const expiresAt = addDaysIso(today, policy.reservationExpiryDays);
          db.prepare(
            `UPDATE reservations
             SET status = 'Tersedia', copy_id = ?, notified_at = datetime('now'), expires_at = ?
             WHERE id = ?`
          ).run(existing.copy_id, expiresAt, nextWaiting.id);

          const book = db.prepare('SELECT title FROM books WHERE id = ?').get(existing.book_id) as
            | { title: string }
            | undefined;

          db.prepare(
            `INSERT INTO notifications (member_id, type, title, message, link)
             VALUES (?, 'success', 'Buku Reservasi Tersedia', ?, '/reservations')`
          ).run(
            nextWaiting.member_id,
            `Buku "${book?.title || 'Koleksi'}" (${nextWaiting.reservation_number}) telah tersedia dan ditahan hingga ${expiresAt}.`
          );
        } else {
          db.prepare("UPDATE book_copies SET status = 'Tersedia', updated_at = datetime('now') WHERE id = ? AND status = 'Direservasi'").run(
            existing.copy_id
          );
        }
      }
    } else if (action === 'pickup') {
      db.prepare("UPDATE reservations SET status = 'Diambil' WHERE id = ?").run(reservationId);
      // Release copy from Direservasi to Tersedia so staff can immediately check it out on /loans
      if (existing.copy_id) {
        db.prepare("UPDATE book_copies SET status = 'Tersedia', updated_at = datetime('now') WHERE id = ? AND status = 'Direservasi'").run(
          existing.copy_id
        );
      }
    }

    logAudit(db, {
      userId: guard.user.id,
      userName: guard.user.fullName,
      action: `RESERVATION_${action.toUpperCase()}`,
      entityType: 'reservations',
      entityId: existing.reservation_number,
      before: { status: existing.status },
      after: { status: action === 'cancel' ? 'Dibatalkan' : 'Diambil' },
    });
  })();

  return NextResponse.json({ ok: true });
}
