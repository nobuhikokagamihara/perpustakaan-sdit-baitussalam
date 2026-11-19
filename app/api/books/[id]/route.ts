import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { formatIsoDate } from '@/lib/domain/library-rules';
import {
  clampText,
  validateCoverUrl,
  validateIsbnFormat,
} from '@/lib/domain/book-catalog-rules';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('books.read');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const bookId = Number(id);
  const db = getDb();

  const book = db
    .prepare(
      `SELECT b.*, c.name as category_name, p.name as publisher_name,
              GROUP_CONCAT(DISTINCT a.name) as authors
       FROM books b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       WHERE b.id = ?
       GROUP BY b.id`
    )
    .get(bookId);

  if (!book) {
    return NextResponse.json({ error: 'Buku tidak ditemukan.' }, { status: 404 });
  }

  const copies = db
    .prepare(
      `SELECT bc.*, s.code as shelf_code, s.name as shelf_name, l.building, l.room
       FROM book_copies bc
       LEFT JOIN shelves s ON s.id = bc.shelf_id
       LEFT JOIN locations l ON l.id = s.location_id
       WHERE bc.book_id = ? AND bc.archived_at IS NULL
       ORDER BY bc.id ASC`
    )
    .all(bookId);

  const history = db
    .prepare(
      `SELECT li.id, l.loan_number, l.loan_date, li.due_date, li.returned_at, li.status,
              bc.inventory_code, m.full_name as member_name, m.member_code
       FROM loan_items li
       JOIN loans l ON l.id = li.loan_id
       JOIN members m ON m.id = l.member_id
       JOIN book_copies bc ON bc.id = li.copy_id
       WHERE bc.book_id = ?
       ORDER BY l.loan_date DESC, li.id DESC
       LIMIT 30`
    )
    .all(bookId);

  return NextResponse.json({ book, copies, history });
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('books.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const bookId = Number(id);
  const body = await req.json();
  const db = getDb();

  const before = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
    | Record<string, unknown>
    | undefined;
  if (!before) {
    return NextResponse.json({ error: 'Buku tidak ditemukan.' }, { status: 404 });
  }

  const title = clampText(body.title, 240);
  if (!title) {
    return NextResponse.json({ error: 'Judul buku wajib diisi.' }, { status: 400 });
  }

  const isbnRaw = body.isbn ? String(body.isbn).trim() : '';
  const isbnCheck = validateIsbnFormat(isbnRaw);
  if (!isbnCheck.valid) {
    return NextResponse.json({ error: isbnCheck.reason || 'Format ISBN tidak valid.' }, { status: 400 });
  }
  const isbn = isbnCheck.normalized || null;

  const coverCheck = validateCoverUrl(
    body.coverUrl !== undefined ? String(body.coverUrl) : String(before.cover_url || '')
  );
  if (!coverCheck.valid) {
    return NextResponse.json({ error: coverCheck.reason || 'Format link cover tidak valid.' }, { status: 400 });
  }
  const coverUrl = coverCheck.normalized;

  if (isbn) {
    const duplicate = db
      .prepare('SELECT id FROM books WHERE isbn = ? AND id != ?')
      .get(isbn, bookId);
    if (duplicate) {
      return NextResponse.json(
        { error: `ISBN ${isbn} sudah digunakan oleh judul buku lain.` },
        { status: 409 }
      );
    }
  }

  const publishYear = Number(body.publishYear ?? before.publish_year ?? 2025);
  if (!Number.isInteger(publishYear) || publishYear < 1900 || publishYear > 2100) {
    return NextResponse.json({ error: 'Tahun terbit harus antara 1900 hingga 2100.' }, { status: 400 });
  }

  if (typeof body.authors === 'string') {
    const parsedAuthors = body.authors
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (parsedAuthors.length === 0) {
      return NextResponse.json({ error: 'Minimal satu nama penulis wajib diisi.' }, { status: 400 });
    }
  }

  const publisherName = clampText(body.publisher, 120);
  const publishCity = clampText(body.publishCity, 100);

  db.transaction(() => {
    let publisherId: number | null = (before.publisher_id as number | null) ?? null;
    if (publisherName) {
      const exPub = db
        .prepare('SELECT id FROM publishers WHERE lower(name) = lower(?)')
        .get(publisherName) as { id: number } | undefined;
      if (exPub) {
        publisherId = exPub.id;
        if (publishCity) {
          db.prepare('UPDATE publishers SET city = ? WHERE id = ?').run(publishCity, publisherId);
        }
      } else {
        publisherId = Number(
          db.prepare('INSERT INTO publishers (name, city) VALUES (?, ?)').run(publisherName, publishCity).lastInsertRowid
        );
      }
    }

    db.prepare(
      `UPDATE books
       SET title = ?, subtitle = ?, series_name = ?, volume = ?, isbn = ?, edition = ?,
           publish_year = ?, publish_city = ?, language = ?, description = ?, table_of_contents = ?,
           pages = ?, dimensions = ?, binding_type = ?, paper_type = ?, weight_grams = ?,
           illustration_notes = ?, cover_url = ?, price = ?, publisher_id = ?, category_id = ?,
           subcategory = ?, ddc_code = ?, call_number = ?, subjects = ?, target_grade = ?,
           age_range = ?, illustrator = ?, editor = ?, translator = ?, acquisition_source = ?,
           acquisition_date = ?, is_reference_only = ?, read_in_place_only = ?, is_featured = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      title,
      clampText(body.subtitle, 240),
      clampText(body.seriesName, 160),
      clampText(body.volume, 60),
      isbn,
      clampText(body.edition, 80, String(before.edition || 'Cetakan 1')),
      publishYear,
      publishCity,
      clampText(body.language, 60, String(before.language || 'Indonesia')),
      clampText(body.description, 2000),
      clampText(body.tableOfContents, 2000),
      Math.max(1, Number(body.pages || before.pages || 100)),
      clampText(body.dimensions, 80),
      clampText(body.bindingType, 80, String(before.binding_type || 'Softcover (Art Carton)')),
      clampText(body.paperType, 80),
      Math.max(0, Math.min(20000, Number(body.weightGrams ?? before.weight_grams ?? 0))),
      clampText(body.illustrationNotes, 160),
      coverUrl,
      Math.max(0, Number(body.price ?? before.price ?? 0)),
      publisherId,
      body.categoryId ? Number(body.categoryId) : null,
      clampText(body.subcategory, 120),
      clampText(body.ddcCode, 40),
      clampText(body.callNumber, 60),
      clampText(body.subjects, 300),
      clampText(body.targetGrade, 80, String(before.target_grade || 'Semua Kelas (1–6 SD)')),
      clampText(body.ageRange, 60),
      clampText(body.illustrator, 160),
      clampText(body.editor, 160),
      clampText(body.translator, 160),
      clampText(body.acquisitionSource, 120, String(before.acquisition_source || 'Pembelian Dana BOS')),
      clampText(body.acquisitionDate, 32, String(before.acquisition_date || formatIsoDate(new Date()))),
      body.isReferenceOnly ? 1 : 0,
      body.readInPlaceOnly ? 1 : 0,
      body.isFeatured ? 1 : 0,
      bookId
    );

    if (typeof body.authors === 'string') {
      const names = body.authors
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      db.prepare('DELETE FROM book_authors WHERE book_id = ?').run(bookId);
      for (const name of names) {
        let aRow = db.prepare('SELECT id FROM authors WHERE lower(name) = lower(?)').get(name) as
          | { id: number }
          | undefined;
        if (!aRow) {
          aRow = {
            id: Number(db.prepare('INSERT INTO authors (name) VALUES (?)').run(name).lastInsertRowid),
          };
        }
        db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)').run(
          bookId,
          aRow.id
        );
      }
    }

    logAudit(db, {
      userId: guard.user.id,
      userName: guard.user.fullName,
      action: 'BOOK_UPDATE',
      entityType: 'books',
      entityId: bookId,
      before,
      after: { title, isbn, coverUrl },
    });
  })();

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('books.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const bookId = Number(id);
  const body = await req.json();
  const db = getDb();

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
    | { id: number; price: number }
    | undefined;
  if (!book) {
    return NextResponse.json({ error: 'Buku tidak ditemukan.' }, { status: 404 });
  }

  if (body.action === 'add_copies') {
    const count = Math.max(1, Math.min(30, Number(body.count || 1)));
    const shelfId = body.shelfId ? Number(body.shelfId) : null;
    const settings = getSettingsMap(db);
    const invPrefix = settings.inventory_code_prefix || 'LP-2026-';
    const today = formatIsoDate(new Date());

    db.transaction(() => {
      const maxSeqRow = db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM book_copies').get() as {
        m: number;
      };
      let seq = maxSeqRow.m + 1;
      const checkInvStmt = db.prepare('SELECT 1 FROM book_copies WHERE inventory_code = ?');
      const checkBcStmt = db.prepare('SELECT 1 FROM book_copies WHERE barcode = ?');
      const ins = db.prepare(
        `INSERT INTO book_copies (book_id, inventory_code, barcode, shelf_id, condition, status, acquisition_date, price)
         VALUES (?, ?, ?, ?, ?, 'Tersedia', ?, ?)`
      );
      for (let i = 0; i < count; i++) {
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
        ins.run(
          bookId,
          invCode,
          barcode,
          shelfId,
          String(body.condition || 'Baik'),
          today,
          book.price
        );
        seq++;
      }
      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'COPIES_ADD',
        entityType: 'books',
        entityId: bookId,
        after: { count, shelfId },
      });
    })();

    return NextResponse.json({ ok: true });
  }

  if (body.action === 'update_copy' && body.copyId) {
    const copyId = Number(body.copyId);
    const copy = db.prepare('SELECT * FROM book_copies WHERE id = ? AND book_id = ?').get(copyId, bookId) as
      | { id: number; status: string }
      | undefined;
    if (!copy) return NextResponse.json({ error: 'Eksemplar tidak ditemukan.' }, { status: 404 });

    const requestedStatus = body.status ? String(body.status) : null;
    if (
      requestedStatus &&
      requestedStatus !== copy.status &&
      (copy.status === 'Dipinjam' || copy.status === 'Direservasi')
    ) {
      return NextResponse.json(
        {
          error: `Eksemplar berstatus ${copy.status} tidak dapat diubah statusnya langsung. Gunakan menu Sirkulasi/Pengembalian.`,
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
        action: 'COPY_UPDATE',
        entityType: 'book_copies',
        entityId: copyId,
        before: copy,
        after: body,
      });
    })();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenali.' }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('books.archive');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const bookId = Number(id);
  const db = getDb();

  const activeBorrow = db
    .prepare(
      `SELECT COUNT(*) as c FROM book_copies WHERE book_id = ? AND status = 'Dipinjam' AND archived_at IS NULL`
    )
    .get(bookId) as { c: number };

  if (activeBorrow.c > 0) {
    return NextResponse.json(
      { error: 'Buku tidak dapat diarsipkan karena masih ada eksemplar yang sedang dipinjam.' },
      { status: 409 }
    );
  }

  db.transaction(() => {
    db.prepare("UPDATE books SET archived_at = datetime('now') WHERE id = ?").run(bookId);
    db.prepare("UPDATE book_copies SET archived_at = datetime('now'), status = 'Dihapus' WHERE book_id = ?").run(
      bookId
    );
    logAudit(db, {
      userId: guard.user.id,
      userName: guard.user.fullName,
      action: 'BOOK_ARCHIVE',
      entityType: 'books',
      entityId: bookId,
    });
  })();

  return NextResponse.json({ ok: true, archived: true });
}
