import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { computeStockOpnameDiscrepancy } from '@/lib/domain/library-rules';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('inventory.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const auditId = req.nextUrl.searchParams.get('auditId');

  const locations = db.prepare('SELECT * FROM locations ORDER BY code ASC').all();
  const shelves = db
    .prepare(
      `SELECT s.*, l.building, l.floor, l.room,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.shelf_id = s.id AND bc.archived_at IS NULL AND bc.status != 'Dihapus') as current_count
       FROM shelves s
       JOIN locations l ON l.id = s.location_id
       ORDER BY s.code ASC`
    )
    .all();

  const copies = db
    .prepare(
      `SELECT bc.*, b.title as book_title, b.isbn, b.is_reference_only, b.read_in_place_only,
              c.name as category_name,
              s.code as shelf_code, s.name as shelf_name, l.building, l.room
       FROM book_copies bc
       JOIN books b ON b.id = bc.book_id
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN shelves s ON s.id = bc.shelf_id
       LEFT JOIN locations l ON l.id = s.location_id
       WHERE bc.archived_at IS NULL
       ORDER BY bc.id DESC
       LIMIT 200`
    )
    .all();

  const audits = db
    .prepare(
      `SELECT ia.*, s.code as shelf_code, s.name as shelf_name, u.full_name as conducted_by_name
       FROM inventory_audits ia
       LEFT JOIN shelves s ON s.id = ia.shelf_id
       LEFT JOIN users u ON u.id = ia.conducted_by_user_id
       ORDER BY ia.id DESC`
    )
    .all();

  let activeAuditItems: Array<Record<string, unknown>> = [];
  if (auditId) {
    activeAuditItems = db
      .prepare(
        `SELECT iai.*, bc.inventory_code, bc.barcode, bc.status as current_system_status,
                b.title as book_title, s.code as shelf_code
         FROM inventory_audit_items iai
         JOIN book_copies bc ON bc.id = iai.copy_id
         JOIN books b ON b.id = bc.book_id
         LEFT JOIN shelves s ON s.id = bc.shelf_id
         WHERE iai.audit_id = ?
         ORDER BY iai.scanned_at DESC`
      )
      .all(Number(auditId)) as Array<Record<string, unknown>>;
  }

  return NextResponse.json({ locations, shelves, copies, audits, activeAuditItems });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('inventory.write');
  if (guard.errorResponse) return guard.errorResponse;

  const body = await req.json();
  const action = String(body.action || '');
  const db = getDb();

  if (action === 'create_location') {
    const code = String(body.code || '').trim();
    const building = String(body.building || '').trim();
    const room = String(body.room || '').trim();
    if (!code || !building || !room) {
      return NextResponse.json({ error: 'Kode, gedung, dan ruangan wajib diisi.' }, { status: 400 });
    }
    const dup = db.prepare('SELECT id FROM locations WHERE lower(code) = lower(?)').get(code);
    if (dup) {
      return NextResponse.json({ error: `Kode lokasi '${code}' sudah digunakan.` }, { status: 409 });
    }
    const id = db.transaction(() => {
      const insertedId = Number(
        db
          .prepare('INSERT INTO locations (code, building, floor, room, description) VALUES (?, ?, ?, ?, ?)')
          .run(code, building, String(body.floor || 'Lantai 1'), room, String(body.description || '')).lastInsertRowid
      );
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'LOCATION_CREATE',
        entityType: 'locations',
        entityId: code,
        after: body,
      });
      return insertedId;
    })();
    return NextResponse.json({ id }, { status: 201 });
  }

  if (action === 'create_shelf') {
    const locationId = Number(body.locationId);
    const code = String(body.code || '').trim();
    const name = String(body.name || '').trim();
    if (!locationId || !code || !name) {
      return NextResponse.json({ error: 'Lokasi, kode rak, dan nama rak wajib diisi.' }, { status: 400 });
    }
    const dup = db.prepare('SELECT id FROM shelves WHERE lower(code) = lower(?)').get(code);
    if (dup) {
      return NextResponse.json({ error: `Kode rak '${code}' sudah digunakan.` }, { status: 409 });
    }
    const id = db.transaction(() => {
      const insertedId = Number(
        db
          .prepare('INSERT INTO shelves (location_id, code, name, capacity) VALUES (?, ?, ?, ?)')
          .run(locationId, code, name, Number(body.capacity || 150)).lastInsertRowid
      );
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'SHELF_CREATE',
        entityType: 'shelves',
        entityId: code,
        after: body,
      });
      return insertedId;
    })();
    return NextResponse.json({ id }, { status: 201 });
  }

  if (action === 'transfer_copy' || action === 'update_copy_status') {
    const copyId = Number(body.copyId);
    const before = db.prepare('SELECT * FROM book_copies WHERE id = ?').get(copyId) as
      | { id: number; status: string }
      | undefined;
    if (!before) return NextResponse.json({ error: 'Eksemplar tidak ditemukan.' }, { status: 404 });

    const requestedStatus = body.status ? String(body.status) : null;
    if (
      requestedStatus &&
      requestedStatus !== before.status &&
      (before.status === 'Dipinjam' || before.status === 'Direservasi')
    ) {
      return NextResponse.json(
        {
          error: `Status eksemplar '${before.status}' tidak dapat ditimpa langsung. Selesaikan melalui Sirkulasi atau Reservasi.`,
        },
        { status: 400 }
      );
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE book_copies
         SET shelf_id = COALESCE(?, shelf_id),
             condition = COALESCE(?, condition),
             status = COALESCE(?, status),
             notes = COALESCE(?, notes),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        body.shelfId ? Number(body.shelfId) : null,
        body.condition || null,
        requestedStatus,
        body.notes !== undefined ? String(body.notes) : null,
        copyId
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: action === 'transfer_copy' ? 'COPY_SHELF_TRANSFER' : 'COPY_CONDITION_UPDATE',
        entityType: 'book_copies',
        entityId: copyId,
        before,
        after: body,
      });
    })();
    return NextResponse.json({ ok: true });
  }

  if (action === 'start_audit') {
    const title = String(body.title || '').trim() || 'Stock Opname Koleksi';
    const shelfId = body.shelfId ? Number(body.shelfId) : null;

    const created = db.transaction(() => {
      const expectedCount = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM book_copies
             WHERE archived_at IS NULL AND status != 'Dihapus' ${shelfId ? 'AND shelf_id = ?' : ''}`
          )
          .get(...(shelfId ? [shelfId] : [])) as { c: number }
      ).c;

      const maxId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM inventory_audits').get() as { m: number }
      ).m;
      const auditNumber = `OPN-2026-${String(maxId + 1).padStart(4, '0')}`;

      const auditId = Number(
        db
          .prepare(
            `INSERT INTO inventory_audits (audit_number, title, shelf_id, conducted_by_user_id, total_expected, notes)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(auditNumber, title, shelfId, guard.user.id, expectedCount, String(body.notes || '')).lastInsertRowid
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'STOCK_OPNAME_START',
        entityType: 'inventory_audits',
        entityId: auditNumber,
        after: { title, shelfId, expectedCount },
      });

      return { id: auditId, auditNumber };
    })();

    return NextResponse.json(created, { status: 201 });
  }

  if (action === 'scan_audit_item') {
    const auditId = Number(body.auditId);
    const code = String(body.code || '').trim();
    const physicalStatus = String(body.physicalStatus || 'Ditemukan');

    const audit = db.prepare('SELECT id, status FROM inventory_audits WHERE id = ?').get(auditId) as
      | { id: number; status: string }
      | undefined;
    if (!audit) {
      return NextResponse.json({ error: 'Sesi stock opname tidak ditemukan.' }, { status: 404 });
    }
    if (audit.status !== 'Berlangsung') {
      return NextResponse.json(
        { error: 'Sesi stock opname ini sudah selesai dan tidak menerima pemindaian baru.' },
        { status: 400 }
      );
    }

    const copy = db
      .prepare('SELECT * FROM book_copies WHERE (inventory_code = ? OR barcode = ?) AND archived_at IS NULL')
      .get(code, code) as { id: number; status: string; inventory_code: string } | undefined;

    if (!copy) {
      return NextResponse.json(
        { error: `Kode inventaris atau barcode '${code}' tidak ditemukan.` },
        { status: 404 }
      );
    }

    db.transaction(() => {
      db.prepare(
        `INSERT INTO inventory_audit_items (audit_id, copy_id, expected_status, physical_status, notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(audit_id, copy_id) DO UPDATE SET
           physical_status = excluded.physical_status,
           scanned_at = datetime('now'),
           notes = excluded.notes`
      ).run(auditId, copy.id, copy.status, physicalStatus, String(body.notes || ''));

      const scannedCount = (
        db.prepare('SELECT COUNT(*) as c FROM inventory_audit_items WHERE audit_id = ?').get(auditId) as {
          c: number;
        }
      ).c;

      db.prepare('UPDATE inventory_audits SET total_scanned = ? WHERE id = ?').run(scannedCount, auditId);
    })();
    return NextResponse.json({ ok: true, copyId: copy.id, inventoryCode: copy.inventory_code });
  }

  if (action === 'complete_audit') {
    const auditId = Number(body.auditId);
    const audit = db.prepare('SELECT * FROM inventory_audits WHERE id = ?').get(auditId) as
      | { id: number; audit_number: string; shelf_id: number | null; status: string }
      | undefined;
    if (!audit) return NextResponse.json({ error: 'Sesi opname tidak ditemukan.' }, { status: 404 });
    if (audit.status !== 'Berlangsung') {
      return NextResponse.json({ error: 'Sesi stock opname ini sudah diselesaikan sebelumnya.' }, { status: 400 });
    }

    const discrepancy = db.transaction(() => {
      const expectedCopies = db
        .prepare(
          `SELECT id, status FROM book_copies
           WHERE archived_at IS NULL AND status != 'Dihapus' ${audit.shelf_id ? 'AND shelf_id = ?' : ''}`
        )
        .all(...(audit.shelf_id ? [audit.shelf_id] : [])) as Array<{ id: number; status: string }>;

      const scannedItems = db
        .prepare('SELECT copy_id, physical_status FROM inventory_audit_items WHERE audit_id = ?')
        .all(auditId) as Array<{ copy_id: number; physical_status: string }>;

      const disc = computeStockOpnameDiscrepancy(expectedCopies, scannedItems);

      db.prepare(
        `UPDATE inventory_audits
         SET status = 'Selesai', completed_at = datetime('now'),
             total_expected = ?, total_scanned = ?, total_discrepancy = ?
         WHERE id = ?`
      ).run(expectedCopies.length, scannedItems.length, disc.totalDiscrepancy, auditId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'STOCK_OPNAME_COMPLETE',
        entityType: 'inventory_audits',
        entityId: audit.audit_number,
        after: disc,
      });

      return disc;
    })();

    return NextResponse.json({ ok: true, discrepancy });
  }

  return NextResponse.json({ error: 'Aksi inventaris tidak dikenali.' }, { status: 400 });
}
