import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { formatIsoDate } from '@/lib/domain/library-rules';

import { validateCoverUrl } from '@/lib/domain/book-catalog-rules';

interface ImportRowInput {
  title?: string;
  subtitle?: string;
  isbn?: string;
  authors?: string;
  publisher?: string;
  publishYear?: number | string;
  category?: string;
  price?: number | string;
  copies?: number | string;
  coverUrl?: string;
  ddcCode?: string;
  callNumber?: string;
  targetGrade?: string;
  language?: string;
  pages?: number | string;
  description?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('books.import_export');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const mode = body.mode === 'commit' ? 'commit' : 'preview';
    const skipInvalid = Boolean(body.skipInvalid);
    const rows: ImportRowInput[] = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tidak ada baris data untuk diproses.' }, { status: 400 });
    }

    const db = getDb();
    const existingIsbns = new Set(
      (db.prepare('SELECT isbn FROM books WHERE isbn IS NOT NULL').all() as Array<{ isbn: string }>).map(
        (r) => r.isbn.trim()
      )
    );
    const seenInFile = new Set<string>();

    const evaluated = rows.map((row, idx) => {
      const errors: string[] = [];
      const title = String(row.title || '').trim();
      const isbn = String(row.isbn || '').trim();
      const authors = String(row.authors || '').trim();
      const year = Number(row.publishYear || new Date().getFullYear());
      const copies = Number(row.copies || 1);
      const coverCheck = validateCoverUrl(String(row.coverUrl || ''));

      if (!title) errors.push('Judul kosong');
      if (!authors) errors.push('Penulis kosong');
      if (!coverCheck.valid) errors.push(coverCheck.reason || 'Link cover tidak valid');
      if (Number.isNaN(year) || year < 1800 || year > 2100) errors.push('Tahun terbit tidak valid');
      if (Number.isNaN(copies) || copies < 1 || copies > 50) errors.push('Jumlah eksemplar harus 1-50');
      if (isbn && existingIsbns.has(isbn)) errors.push(`Duplikat ISBN di database (${isbn})`);
      if (isbn && seenInFile.has(isbn)) errors.push(`Duplikat ISBN dalam file (${isbn})`);
      if (isbn) seenInFile.add(isbn);

      return {
        rowNumber: idx + 1,
        title,
        subtitle: String(row.subtitle || '').trim().slice(0, 240),
        isbn,
        authors,
        publisher: String(row.publisher || 'Umum').trim(),
        publishYear: year,
        category: String(row.category || 'Cerita Anak & Dongeng').trim(),
        price: Math.max(0, Number(row.price || 65000)),
        copies,
        coverUrl: coverCheck.normalized,
        ddcCode: String(row.ddcCode || '').trim().slice(0, 40),
        callNumber: String(row.callNumber || '').trim().slice(0, 60),
        targetGrade: String(row.targetGrade || 'Semua Kelas (1–6 SD)').trim().slice(0, 80),
        language: String(row.language || 'Indonesia').trim().slice(0, 60),
        pages: Math.max(1, Number(row.pages || 96)),
        description: String(row.description || '').trim().slice(0, 2000),
        valid: errors.length === 0,
        errors,
      };
    });

    const invalidRows = evaluated.filter((r) => !r.valid);
    if (mode === 'preview') {
      return NextResponse.json({
        total: evaluated.length,
        validCount: evaluated.length - invalidRows.length,
        invalidCount: invalidRows.length,
        rows: evaluated,
      });
    }

    if (invalidRows.length > 0 && !skipInvalid) {
      return NextResponse.json(
        { error: 'Masih ada baris tidak valid atau duplikat. Perbaiki atau aktifkan opsi lewati baris bermasalah.' },
        { status: 400 }
      );
    }

    const toInsert = evaluated.filter((r) => r.valid);
    const settings = getSettingsMap(db);
    const invPrefix = settings.inventory_code_prefix || 'LP-2026-';
    const today = formatIsoDate(new Date());

    const insertedCount = db.transaction(() => {
      let count = 0;
      const maxSeqRow = db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM book_copies').get() as {
        m: number;
      };
      let seq = maxSeqRow.m + 1;
      let catSeq = (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM categories').get() as { m: number }).m + 1;
      const checkCatCodeStmt = db.prepare('SELECT 1 FROM categories WHERE code = ?');
      const checkInvStmt = db.prepare('SELECT 1 FROM book_copies WHERE inventory_code = ?');
      const checkBcStmt = db.prepare('SELECT 1 FROM book_copies WHERE barcode = ?');

      for (const r of toInsert) {
        let cat = db
          .prepare('SELECT id FROM categories WHERE lower(name) = lower(?)')
          .get(r.category) as { id: number } | undefined;
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
                .run(catCode, r.category).lastInsertRowid
            ),
          };
        }

        let pub = db
          .prepare('SELECT id FROM publishers WHERE lower(name) = lower(?)')
          .get(r.publisher) as { id: number } | undefined;
        if (!pub) {
          pub = {
            id: Number(
              db.prepare('INSERT INTO publishers (name) VALUES (?)').run(r.publisher).lastInsertRowid
            ),
          };
        }

        const bookId = Number(
          db
            .prepare(
              `INSERT INTO books (
                 title, subtitle, isbn, publish_year, language, pages, description,
                 cover_url, ddc_code, call_number, target_grade, price, publisher_id,
                 category_id, acquisition_date
               )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              r.title,
              r.subtitle,
              r.isbn || null,
              r.publishYear,
              r.language,
              r.pages,
              r.description,
              r.coverUrl,
              r.ddcCode,
              r.callNumber,
              r.targetGrade,
              r.price,
              pub.id,
              cat.id,
              today
            ).lastInsertRowid
        );

        for (const authorName of r.authors.split(',').map((s) => s.trim()).filter(Boolean)) {
          let aut = db
            .prepare('SELECT id FROM authors WHERE lower(name) = lower(?)')
            .get(authorName) as { id: number } | undefined;
          if (!aut) {
            aut = {
              id: Number(db.prepare('INSERT INTO authors (name) VALUES (?)').run(authorName).lastInsertRowid),
            };
          }
          db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id) VALUES (?, ?)').run(
            bookId,
            aut.id
          );
        }

        for (let i = 0; i < r.copies; i++) {
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
            `INSERT INTO book_copies (book_id, inventory_code, barcode, condition, status, acquisition_date, price)
             VALUES (?, ?, ?, 'Baik', 'Tersedia', ?, ?)`
          ).run(bookId, invCode, barcode, today, r.price);
          seq++;
        }
        count++;
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'BOOKS_IMPORT',
        entityType: 'books',
        entityId: 'bulk',
        after: { importedBooks: count },
      });

      return count;
    })();

    return NextResponse.json({ ok: true, importedCount: insertedCount });
  } catch (err) {
    console.error('Import books error:', err);
    return NextResponse.json({ error: 'Gagal memproses import koleksi.' }, { status: 500 });
  }
}
