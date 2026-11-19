import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { formatIsoDate } from '@/lib/domain/library-rules';

export async function GET() {
  const guard = await requirePermission('acquisitions.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all();
  const acquisitions = db
    .prepare(
      `SELECT a.*, s.name as supplier_name,
              u1.full_name as requested_by_name,
              u2.full_name as approved_by_name
       FROM acquisitions a
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       LEFT JOIN users u1 ON u1.id = a.requested_by_user_id
       LEFT JOIN users u2 ON u2.id = a.approved_by_user_id
       ORDER BY a.id DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const itemStmt = db.prepare('SELECT * FROM acquisition_items WHERE acquisition_id = ?');
  const enriched = acquisitions.map((a) => ({
    ...a,
    items: itemStmt.all(a.id),
  }));

  const categories = db.prepare('SELECT id, name FROM categories ORDER BY name ASC').all();
  const shelves = db.prepare('SELECT id, code, name FROM shelves ORDER BY code ASC').all();

  return NextResponse.json({ suppliers, acquisitions: enriched, categories, shelves });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = String(body.action || '');
  const db = getDb();

  if (action === 'create_supplier') {
    const guard = await requirePermission('acquisitions.write');
    if (guard.errorResponse) return guard.errorResponse;

    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Nama pemasok wajib diisi.' }, { status: 400 });

    const created = db.transaction(() => {
      let supSeq =
        (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM suppliers').get() as { m: number }).m + 1;
      let code = `SUP-${String(supSeq).padStart(3, '0')}`;
      const checkSupCode = db.prepare('SELECT 1 FROM suppliers WHERE code = ?');
      while (checkSupCode.get(code)) {
        supSeq++;
        code = `SUP-${String(supSeq).padStart(3, '0')}`;
      }
      const id = Number(
        db
          .prepare(
            'INSERT INTO suppliers (code, name, contact_person, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(
            code,
            name,
            String(body.contactPerson || ''),
            String(body.phone || ''),
            String(body.email || ''),
            String(body.address || '')
          ).lastInsertRowid
      );
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'SUPPLIER_CREATE',
        entityType: 'suppliers',
        entityId: code,
        after: { name },
      });
      return { id, code };
    })();
    return NextResponse.json(created, { status: 201 });
  }

  if (action === 'create_request') {
    const guard = await requirePermission('acquisitions.write');
    if (guard.errorResponse) return guard.errorResponse;

    const titleSummary = String(body.titleSummary || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!titleSummary || items.length === 0) {
      return NextResponse.json(
        { error: 'Ringkasan pengadaan dan minimal 1 item buku wajib diisi.' },
        { status: 400 }
      );
    }

    const totalCost = items.reduce(
      (sum: number, it: Record<string, unknown>) =>
        sum + Number(it.quantity || 1) * Number(it.unitPrice || 0),
      0
    );
    const maxId = (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM acquisitions').get() as { m: number }).m;
    const requestNumber = `PGD-2026-${String(maxId + 1).padStart(4, '0')}`;

    const acqId = db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO acquisitions (request_number, title_summary, supplier_id, requested_by_user_id, total_estimated_cost, status, notes)
             VALUES (?, ?, ?, ?, ?, 'Menunggu Persetujuan', ?)`
          )
          .run(
            requestNumber,
            titleSummary,
            body.supplierId ? Number(body.supplierId) : null,
            guard.user.id,
            totalCost,
            String(body.notes || '')
          ).lastInsertRowid
      );

      const insItem = db.prepare(
        `INSERT INTO acquisition_items (acquisition_id, title, isbn, author_name, publisher_name, category_name, quantity_ordered, unit_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        insItem.run(
          id,
          String(it.title || '').trim(),
          String(it.isbn || '').trim(),
          String(it.authorName || '').trim(),
          String(it.publisherName || '').trim(),
          String(it.categoryName || 'Cerita Anak & Dongeng').trim(),
          Math.max(1, Number(it.quantity || 1)),
          Math.max(0, Number(it.unitPrice || 0))
        );
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'ACQUISITION_CREATE',
        entityType: 'acquisitions',
        entityId: requestNumber,
        after: { titleSummary, totalCost, itemCount: items.length },
      });
      return id;
    })();

    return NextResponse.json({ id: acqId, requestNumber }, { status: 201 });
  }

  if (action === 'approve' || action === 'reject') {
    const guard = await requirePermission('acquisitions.approve');
    if (guard.errorResponse) return guard.errorResponse;

    const acqId = Number(body.acquisitionId);
    const existing = db
      .prepare('SELECT id, request_number, status FROM acquisitions WHERE id = ?')
      .get(acqId) as { id: number; request_number: string; status: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Usulan pengadaan tidak ditemukan.' }, { status: 404 });
    }
    if (existing.status !== 'Diajukan' && existing.status !== 'Menunggu Persetujuan') {
      return NextResponse.json(
        { error: `Usulan berstatus '${existing.status}' tidak dapat diproses persetujuannya.` },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'Disetujui' : 'Ditolak';
    db.transaction(() => {
      db.prepare(
        `UPDATE acquisitions SET status = ?, approved_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newStatus, guard.user.id, acqId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: `ACQUISITION_${action.toUpperCase()}`,
        entityType: 'acquisitions',
        entityId: existing.request_number,
        before: { status: existing.status },
        after: { status: newStatus },
      });
    })();
    return NextResponse.json({ ok: true, status: newStatus });
  }

  if (action === 'mark_ordered') {
    const guard = await requirePermission('acquisitions.write');
    if (guard.errorResponse) return guard.errorResponse;
    const acqId = Number(body.acquisitionId);
    const existing = db
      .prepare('SELECT id, request_number, status FROM acquisitions WHERE id = ?')
      .get(acqId) as { id: number; request_number: string; status: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Usulan pengadaan tidak ditemukan.' }, { status: 404 });
    }
    if (existing.status !== 'Disetujui') {
      return NextResponse.json(
        { error: 'Hanya usulan berstatus Disetujui yang dapat ditandai dipesan.' },
        { status: 400 }
      );
    }

    const today = formatIsoDate(new Date());
    db.transaction(() => {
      db.prepare(
        `UPDATE acquisitions SET status = 'Dipesan', order_date = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(today, acqId);
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'ACQUISITION_MARK_ORDERED',
        entityType: 'acquisitions',
        entityId: existing.request_number,
        before: { status: existing.status },
        after: { status: 'Dipesan', orderDate: today },
      });
    })();
    return NextResponse.json({ ok: true });
  }

  if (action === 'receive') {
    const guard = await requirePermission('acquisitions.write');
    if (guard.errorResponse) return guard.errorResponse;

    const acqId = Number(body.acquisitionId);
    const existing = db
      .prepare('SELECT id, request_number, status FROM acquisitions WHERE id = ?')
      .get(acqId) as { id: number; request_number: string; status: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Usulan pengadaan tidak ditemukan.' }, { status: 404 });
    }
    if (existing.status !== 'Disetujui' && existing.status !== 'Dipesan') {
      return NextResponse.json(
        { error: `Pengadaan berstatus '${existing.status}' tidak dapat diterima ke katalog.` },
        { status: 400 }
      );
    }

    const shelfId = body.shelfId ? Number(body.shelfId) : null;
    const settings = getSettingsMap(db);
    const invPrefix = settings.inventory_code_prefix || 'LP-2026-';
    const today = formatIsoDate(new Date());

    db.transaction(() => {
      const items = db
        .prepare('SELECT * FROM acquisition_items WHERE acquisition_id = ?')
        .all(acqId) as Array<{
        id: number;
        title: string;
        isbn: string;
        author_name: string;
        publisher_name: string;
        category_name: string;
        quantity_ordered: number;
        quantity_received: number;
        unit_price: number;
      }>;

      const maxSeqRow = db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM book_copies').get() as {
        m: number;
      };
      let seq = maxSeqRow.m + 1;
      let catSeq =
        (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM categories').get() as { m: number }).m + 1;
      const checkCatCodeStmt = db.prepare('SELECT 1 FROM categories WHERE code = ?');
      const checkInvStmt = db.prepare('SELECT 1 FROM book_copies WHERE inventory_code = ?');
      const checkBcStmt = db.prepare('SELECT 1 FROM book_copies WHERE barcode = ?');

      for (const it of items) {
        const remaining = it.quantity_ordered - it.quantity_received;
        if (remaining <= 0) continue;

        let book = it.isbn
          ? (db.prepare('SELECT id FROM books WHERE isbn = ?').get(it.isbn) as { id: number } | undefined)
          : undefined;

        if (!book) {
          let cat = db
            .prepare('SELECT id FROM categories WHERE lower(name) = lower(?)')
            .get(it.category_name) as { id: number } | undefined;
          if (!cat) {
            let catCode = `CAT-${String(catSeq).padStart(3, '0')}`;
            while (checkCatCodeStmt.get(catCode)) {
              catSeq++;
              catCode = `CAT-${String(catSeq).padStart(3, '0')}`;
            }
            catSeq++;
            cat = {
              id: Number(
                db
                  .prepare('INSERT INTO categories (code, name) VALUES (?, ?)')
                  .run(catCode, it.category_name || 'Umum').lastInsertRowid
              ),
            };
          }
          let pub = it.publisher_name
            ? (db
                .prepare('SELECT id FROM publishers WHERE lower(name) = lower(?)')
                .get(it.publisher_name) as { id: number } | undefined)
            : undefined;
          if (!pub && it.publisher_name) {
            pub = {
              id: Number(
                db.prepare('INSERT INTO publishers (name) VALUES (?)').run(it.publisher_name).lastInsertRowid
              ),
            };
          }

          const newBookId = Number(
            db
              .prepare(
                `INSERT INTO books (title, isbn, price, publisher_id, category_id, acquisition_date)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(it.title, it.isbn || null, it.unit_price, pub?.id ?? null, cat.id, today).lastInsertRowid
          );

          if (it.author_name) {
            let aut = db
              .prepare('SELECT id FROM authors WHERE lower(name) = lower(?)')
              .get(it.author_name) as { id: number } | undefined;
            if (!aut) {
              aut = {
                id: Number(
                  db.prepare('INSERT INTO authors (name) VALUES (?)').run(it.author_name).lastInsertRowid
                ),
              };
            }
            db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)').run(
              newBookId,
              aut.id
            );
          }

          book = { id: newBookId };
        }

        for (let i = 0; i < remaining; i++) {
          let invCode = `${invPrefix}${String(seq).padStart(4, '0')}`;
          while (checkInvStmt.get(invCode)) {
            seq++;
            invCode = `${invPrefix}${String(seq).padStart(4, '0')}`;
          }
          let barcode = `BC${Date.now().toString().slice(-6)}${String(seq).padStart(3, '0')}`;
          let bcBump = 0;
          while (checkBcStmt.get(barcode)) {
            bcBump++;
            barcode = `BC${Date.now().toString().slice(-6)}${String(seq + bcBump).padStart(3, '0')}`;
          }
          db.prepare(
            `INSERT INTO book_copies (book_id, inventory_code, barcode, shelf_id, condition, status, acquisition_date, price)
             VALUES (?, ?, ?, ?, 'Baik', 'Tersedia', ?, ?)`
          ).run(book.id, invCode, barcode, shelfId, today, it.unit_price);
          seq++;
        }

        db.prepare(
          `UPDATE acquisition_items SET quantity_received = quantity_ordered, status = 'Diterima' WHERE id = ?`
        ).run(it.id);
      }

      db.prepare(
        `UPDATE acquisitions SET status = 'Selesai', received_date = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(today, acqId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'ACQUISITION_RECEIVE',
        entityType: 'acquisitions',
        entityId: acqId,
        after: { receivedDate: today, shelfId },
      });
    })();

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Aksi pengadaan tidak dikenali.' }, { status: 400 });
}
