import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { extractCirculationPolicy } from '@/lib/domain/settings-backup-rules';

export async function GET(req: NextRequest) {
  const db = getDb();
  const policy = extractCirculationPolicy(getSettingsMap(db));
  if (!policy.enableOpacPublic) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({
        opacDisabled: true,
        books: [],
        categories: [],
        newest: [],
        mostBorrowed: [],
      });
    }
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const categoryId = sp.get('categoryId') || '';
  const availability = sp.get('availability') || 'all';

  let whereSql = 'WHERE b.archived_at IS NULL';
  const params: Array<string | number> = [];

  if (q) {
    whereSql += ` AND (
      b.title LIKE ? OR b.subtitle LIKE ? OR b.isbn LIKE ? OR b.description LIKE ? OR b.subcategory LIKE ?
      OR b.subjects LIKE ? OR b.ddc_code LIKE ? OR b.call_number LIKE ?
      OR EXISTS (
        SELECT 1 FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id = b.id AND a.name LIKE ?
      )
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like, like);
  }

  if (categoryId) {
    const catNum = Number(categoryId);
    if (Number.isInteger(catNum) && catNum > 0) {
      whereSql += ' AND b.category_id = ?';
      params.push(catNum);
    }
  }

  const rows = db
    .prepare(
      `SELECT b.id, b.title, b.subtitle, b.series_name, b.volume, b.isbn, b.edition,
              b.publish_year, b.publish_city, b.language, b.description, b.table_of_contents,
              b.pages, b.dimensions, b.binding_type, b.illustration_notes, b.cover_url,
              b.subcategory, b.ddc_code, b.call_number, b.subjects, b.target_grade, b.age_range,
              b.illustrator, b.editor, b.translator, b.is_reference_only, b.read_in_place_only,
              b.is_featured, b.acquisition_date,
              c.id as category_id, c.name as category_name,
              p.name as publisher_name,
              GROUP_CONCAT(DISTINCT a.name) as authors,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.archived_at IS NULL AND bc.status != 'Dihapus') as total_copies,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.archived_at IS NULL AND bc.status = 'Tersedia') as available_copies,
              (SELECT GROUP_CONCAT(DISTINCT l.building || ' · ' || l.room || ' (' || s.code || ')')
               FROM book_copies bc
               JOIN shelves s ON s.id = bc.shelf_id
               JOIN locations l ON l.id = s.location_id
               WHERE bc.book_id = b.id AND bc.archived_at IS NULL) as shelf_locations,
              (SELECT COUNT(*) FROM book_copies bc2 JOIN loan_items li ON li.copy_id = bc2.id WHERE bc2.book_id = b.id) as borrow_count
       FROM books b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN book_authors ba ON ba.book_id = b.id
       LEFT JOIN authors a ON a.id = ba.author_id
       ${whereSql}
       GROUP BY b.id
       ORDER BY b.created_at DESC, b.id DESC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const filtered = rows.filter((r) => {
    const avail = Number(r.available_copies || 0);
    if (availability === 'available') return avail > 0;
    if (availability === 'borrowed') return avail === 0;
    return true;
  });

  const categories = db.prepare('SELECT id, code, name FROM categories ORDER BY name ASC').all();
  const newest = [...rows].slice(0, 4);
  const mostBorrowed = [...rows]
    .sort((a, b) => Number(b.borrow_count || 0) - Number(a.borrow_count || 0))
    .slice(0, 4);

  return NextResponse.json({
    books: filtered,
    categories,
    newest,
    mostBorrowed,
  });
}
