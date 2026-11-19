import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { formatIsoDate } from '@/lib/domain/library-rules';
import {
  clampText,
  generateCallNumber,
  validateCoverUrl,
  validateIsbnFormat,
} from '@/lib/domain/book-catalog-rules';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('books.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const categoryId = sp.get('categoryId') || '';
  const publisherId = sp.get('publisherId') || '';
  const year = sp.get('year') || '';
  const shelfId = sp.get('shelfId') || '';
  const condition = sp.get('condition') || '';
  const includeArchived = sp.get('includeArchived') === '1';
  const sortBy = sp.get('sortBy') || 'created_at';
  const sortDir = sp.get('sortDir') === 'asc' ? 'ASC' : 'DESC';

  let where = includeArchived ? 'WHERE 1=1' : 'WHERE b.archived_at IS NULL';
  const params: Array<string | number> = [];

  if (q) {
    const like = `%${q}%`;
    where += ` AND (
      b.title LIKE ? OR b.subtitle LIKE ? OR b.isbn LIKE ? OR b.ddc_code LIKE ? OR b.call_number LIKE ? OR b.subjects LIKE ?
      OR EXISTS (SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = b.id AND a.name LIKE ?)
      OR EXISTS (SELECT 1 FROM book_copies bc WHERE bc.book_id = b.id AND (bc.inventory_code LIKE ? OR bc.barcode LIKE ?))
    )`;
    params.push(like, like, like, like, like, like, like, like, like);
  }
  if (categoryId) {
    where += ' AND b.category_id = ?';
    params.push(Number(categoryId));
  }
  if (publisherId) {
    where += ' AND b.publisher_id = ?';
    params.push(Number(publisherId));
  }
  if (year) {
    where += ' AND b.publish_year = ?';
    params.push(Number(year));
  }
  if (shelfId) {
    where += ' AND EXISTS (SELECT 1 FROM book_copies bc WHERE bc.book_id = b.id AND bc.shelf_id = ? AND bc.archived_at IS NULL)';
    params.push(Number(shelfId));
  }
  if (condition) {
    where += ' AND EXISTS (SELECT 1 FROM book_copies bc WHERE bc.book_id = b.id AND bc.condition = ? AND bc.archived_at IS NULL)';
    params.push(condition);
  }

  const allowedSorts: Record<string, string> = {
    title: 'b.title',
    publish_year: 'b.publish_year',
    price: 'b.price',
    created_at: 'b.id',
  };
  const orderCol = allowedSorts[sortBy] || 'b.id';

  const books = db
    .prepare(
      `SELECT b.*, c.name as category_name, p.name as publisher_name,
              GROUP_CONCAT(DISTINCT a.name) as authors,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.archived_at IS NULL AND bc.status != 'Dihapus') as total_copies,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.archived_at IS NULL AND bc.status = 'Tersedia') as available_copies,
              (SELECT s.code || ' - ' || s.name FROM book_copies bc JOIN shelves s ON s.id = bc.shelf_id WHERE bc.book_id = b.id AND bc.archived_at IS NULL LIMIT 1) as primary_shelf
       FROM books b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       ${where}
       GROUP BY b.id
       ORDER BY ${orderCol} ${sortDir}`
    )
    .all(...params);

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const publishers = db.prepare('SELECT * FROM publishers ORDER BY name').all();
  const shelves = db
    .prepare(
      `SELECT s.*, l.building, l.floor, l.room
       FROM shelves s JOIN locations l ON l.id = s.location_id
       ORDER BY s.code`
    )
    .all();

  return NextResponse.json({ books, categories, publishers, shelves });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('books.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const title = clampText(body.title, 240);
    const isbnRaw = body.isbn ? String(body.isbn).trim() : '';
    const isbnCheck = validateIsbnFormat(isbnRaw);
    if (!isbnCheck.valid) {
      return NextResponse.json({ error: isbnCheck.reason || 'Format ISBN tidak valid.' }, { status: 400 });
    }
    const isbn = isbnCheck.normalized || null;

    const coverCheck = validateCoverUrl(String(body.coverUrl || ''));
    if (!coverCheck.valid) {
      return NextResponse.json({ error: coverCheck.reason || 'Format link cover tidak valid.' }, { status: 400 });
    }
    const coverUrl = coverCheck.normalized;

    const authorNames = String(body.authors || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const publisherName = clampText(body.publisher, 120);
    const publishCity = clampText(body.publishCity, 100);
    const categoryId = body.categoryId ? Number(body.categoryId) : null;
    const shelfId = body.shelfId ? Number(body.shelfId) : null;
    const copiesCount = Math.max(1, Math.min(50, Number(body.copiesCount || 1)));
    const publishYear = Number(body.publishYear || new Date().getFullYear());
    const price = Math.max(0, Number(body.price || 0));
    const pages = Math.max(1, Number(body.pages || 100));
    const weightGrams = Math.max(0, Math.min(20000, Number(body.weightGrams || 0)));

    if (!title) {
      return NextResponse.json({ error: 'Judul buku wajib diisi.' }, { status: 400 });
    }
    if (authorNames.length === 0) {
      return NextResponse.json({ error: 'Minimal satu nama penulis wajib diisi.' }, { status: 400 });
    }
    if (!Number.isInteger(publishYear) || publishYear < 1900 || publishYear > 2100) {
      return NextResponse.json({ error: 'Tahun terbit harus antara 1900 hingga 2100.' }, { status: 400 });
    }

    const ddcCode = clampText(body.ddcCode, 40);
    const callNumber =
      clampText(body.callNumber, 60) ||
      (ddcCode ? generateCallNumber({ ddcCode, authors: authorNames.join(', '), title }) : '');

    const db = getDb();
    const settings = getSettingsMap(db);
    const invPrefix = settings.inventory_code_prefix || 'LP-2026-';
    const today = formatIsoDate(new Date());

    if (isbn) {
      const existingIsbn = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn);
      if (existingIsbn) {
        return NextResponse.json(
          { error: `ISBN ${isbn} sudah terdaftar pada koleksi.` },
          { status: 409 }
        );
      }
    }

    const customInventoryCode = body.inventoryCode ? clampText(body.inventoryCode, 64) : '';
    if (customInventoryCode) {
      const existingInv = db
        .prepare('SELECT id FROM book_copies WHERE inventory_code = ?')
        .get(customInventoryCode);
      if (existingInv) {
        return NextResponse.json(
          { error: `Kode inventaris ${customInventoryCode} sudah digunakan eksemplar lain.` },
          { status: 409 }
        );
      }
    }

    const createdBookId = db.transaction(() => {
      let publisherId: number | null = body.publisherId ? Number(body.publisherId) : null;
      if (!publisherId && publisherName) {
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

      const bookId = Number(
        db
          .prepare(
            `INSERT INTO books (
               title, subtitle, series_name, volume, isbn, edition, publish_year, publish_city,
               language, description, table_of_contents, pages, dimensions, binding_type,
               paper_type, weight_grams, illustration_notes, cover_url, price, publisher_id,
               category_id, subcategory, ddc_code, call_number, subjects, target_grade,
               age_range, illustrator, editor, translator, acquisition_source, is_reference_only,
               read_in_place_only, is_featured, acquisition_date
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            title,
            clampText(body.subtitle, 240),
            clampText(body.seriesName, 160),
            clampText(body.volume, 60),
            isbn,
            clampText(body.edition, 80, 'Cetakan 1'),
            publishYear,
            publishCity,
            clampText(body.language, 60, 'Indonesia'),
            clampText(body.description, 2000),
            clampText(body.tableOfContents, 2000),
            pages,
            clampText(body.dimensions, 80),
            clampText(body.bindingType, 80, 'Softcover (Art Carton)'),
            clampText(body.paperType, 80),
            weightGrams,
            clampText(body.illustrationNotes, 160),
            coverUrl,
            price,
            publisherId,
            categoryId,
            clampText(body.subcategory, 120),
            ddcCode,
            callNumber,
            clampText(body.subjects, 300),
            clampText(body.targetGrade, 80, 'Semua Kelas (1–6 SD)'),
            clampText(body.ageRange, 60),
            clampText(body.illustrator, 160),
            clampText(body.editor, 160),
            clampText(body.translator, 160),
            clampText(body.acquisitionSource, 120, 'Pembelian Dana BOS'),
            body.isReferenceOnly ? 1 : 0,
            body.readInPlaceOnly ? 1 : 0,
            body.isFeatured ? 1 : 0,
            clampText(body.acquisitionDate, 32, today)
          ).lastInsertRowid
      );

      for (const authorName of authorNames) {
        let aRow = db
          .prepare('SELECT id FROM authors WHERE lower(name) = lower(?)')
          .get(authorName) as { id: number } | undefined;
        if (!aRow) {
          const aid = Number(
            db.prepare('INSERT INTO authors (name) VALUES (?)').run(authorName).lastInsertRowid
          );
          aRow = { id: aid };
        }
        db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)').run(
          bookId,
          aRow.id
        );
      }

      if (categoryId) {
        db.prepare('INSERT OR IGNORE INTO book_categories (book_id, category_id) VALUES (?, ?)').run(
          bookId,
          categoryId
        );
      }

      const maxSeqRow = db
        .prepare('SELECT COALESCE(MAX(id), 0) as m FROM book_copies')
        .get() as { m: number };
      let seq = maxSeqRow.m + 1;

      const checkInvStmt = db.prepare('SELECT 1 FROM book_copies WHERE inventory_code = ?');
      const checkBcStmt = db.prepare('SELECT 1 FROM book_copies WHERE barcode = ?');
      const insertCopy = db.prepare(`
        INSERT INTO book_copies (book_id, inventory_code, barcode, shelf_id, condition, status, acquisition_date, price, notes)
        VALUES (?, ?, ?, ?, ?, 'Tersedia', ?, ?, ?)
      `);

      for (let i = 0; i < copiesCount; i++) {
        let invCode =
          i === 0 && customInventoryCode
            ? customInventoryCode
            : `${invPrefix}${String(seq).padStart(4, '0')}`;
        if (!(i === 0 && customInventoryCode)) {
          while (checkInvStmt.get(invCode)) {
            seq++;
            invCode = `${invPrefix}${String(seq).padStart(4, '0')}`;
          }
        }
        let barcode = `BC${Date.now().toString().slice(-6)}${String(seq).padStart(3, '0')}`;
        let bcBump = 0;
        while (checkBcStmt.get(barcode)) {
          bcBump++;
          barcode = `BC${Date.now().toString().slice(-6)}${String(seq + bcBump).padStart(3, '0')}`;
        }
        insertCopy.run(
          bookId,
          invCode,
          barcode,
          shelfId,
          clampText(body.condition, 40, 'Baik'),
          clampText(body.acquisitionDate, 32, today),
          price,
          clampText(body.copyNotes || body.notes, 500)
        );
        seq++;
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'BOOK_CREATE',
        entityType: 'books',
        entityId: bookId,
        after: { title, isbn, coverUrl, ddcCode, callNumber, copiesCount },
      });

      return bookId;
    })();

    return NextResponse.json({ id: createdBookId, message: 'Buku dan eksemplar berhasil ditambahkan.' }, { status: 201 });
  } catch (err) {
    console.error('Create book error:', err);
    return NextResponse.json({ error: 'Gagal menyimpan data buku.' }, { status: 500 });
  }
}
