import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { formatIsoDate } from '@/lib/domain/library-rules';

export async function GET() {
  const guard = await requirePermission('dashboard.view');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const today = formatIsoDate(new Date());

  // Sync overdue status for active loans past due_date
  db.prepare(
    `UPDATE loans SET status = 'Terlambat', updated_at = datetime('now')
     WHERE status = 'Aktif' AND due_date < ?`
  ).run(today);
  db.prepare(
    `UPDATE loan_items SET status = 'Terlambat'
     WHERE status = 'Dipinjam' AND due_date < ?`
  ).run(today);

  const totalTitles = (
    db.prepare('SELECT COUNT(*) as c FROM books WHERE archived_at IS NULL').get() as { c: number }
  ).c;
  const totalCopies = (
    db.prepare('SELECT COUNT(*) as c FROM book_copies WHERE archived_at IS NULL AND status != \'Dihapus\'').get() as {
      c: number;
    }
  ).c;
  const availableCopies = (
    db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE archived_at IS NULL AND status = 'Tersedia'").get() as {
      c: number;
    }
  ).c;
  const borrowedCopies = (
    db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE archived_at IS NULL AND status = 'Dipinjam'").get() as {
      c: number;
    }
  ).c;
  const overdueItemsCount = (
    db.prepare("SELECT COUNT(*) as c FROM loan_items WHERE status = 'Terlambat' AND returned_at IS NULL").get() as {
      c: number;
    }
  ).c;
  const activeMembers = (
    db.prepare("SELECT COUNT(*) as c FROM members WHERE archived_at IS NULL AND status = 'Aktif'").get() as {
      c: number;
    }
  ).c;
  const todayLoans = (
    db.prepare('SELECT COUNT(*) as c FROM loans WHERE loan_date = ?').get(today) as { c: number }
  ).c;
  const todayReturns = (
    db.prepare('SELECT COUNT(*) as c FROM returns WHERE date(returned_at) = ?').get(today) as { c: number }
  ).c;
  const activeReservations = (
    db.prepare("SELECT COUNT(*) as c FROM reservations WHERE status IN ('Menunggu', 'Tersedia')").get() as {
      c: number;
    }
  ).c;

  // Popular books
  const popularBooks = db
    .prepare(
      `SELECT b.id, b.title, b.isbn, c.name as category_name,
              COUNT(li.id) as borrow_count,
              (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id AND bc.status = 'Tersedia' AND bc.archived_at IS NULL) as available_count
       FROM books b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN book_copies bc2 ON bc2.book_id = b.id
       LEFT JOIN loan_items li ON li.copy_id = bc2.id
       WHERE b.archived_at IS NULL
       GROUP BY b.id
       ORDER BY borrow_count DESC, b.id ASC
       LIMIT 5`
    )
    .all();

  // Category distribution (borrows + collection)
  const categoryStats = db
    .prepare(
      `SELECT c.name as category,
              COUNT(DISTINCT b.id) as titles_count,
              COUNT(li.id) as loans_count
       FROM categories c
       LEFT JOIN books b ON b.category_id = c.id AND b.archived_at IS NULL
       LEFT JOIN book_copies bc ON bc.book_id = b.id AND bc.archived_at IS NULL
       LEFT JOIN loan_items li ON li.copy_id = bc.id
       GROUP BY c.id
       ORDER BY loans_count DESC, titles_count DESC`
    )
    .all();

  // Overdue items list
  const overdueList = db
    .prepare(
      `SELECT li.id as loan_item_id, l.loan_number, l.id as loan_id, li.due_date,
              m.full_name as member_name, m.member_code, m.phone,
              b.title as book_title, bc.inventory_code, bc.barcode
       FROM loan_items li
       JOIN loans l ON l.id = li.loan_id
       JOIN members m ON m.id = l.member_id
       JOIN book_copies bc ON bc.id = li.copy_id
       JOIN books b ON b.id = bc.book_id
       WHERE li.returned_at IS NULL AND li.due_date < ?
       ORDER BY li.due_date ASC
       LIMIT 8`
    )
    .all(today);

  // Recent transactions (loans + returns combined)
  const recentActivity = db
    .prepare(
      `SELECT 'Peminjaman' as type, l.loan_number as ref_number, m.full_name as member_name,
              l.loan_date as activity_date, l.status as status,
              (SELECT COUNT(*) FROM loan_items li WHERE li.loan_id = l.id) as item_count
       FROM loans l
       JOIN members m ON m.id = l.member_id
       UNION ALL
       SELECT 'Pengembalian' as type, r.return_number as ref_number, m.full_name as member_name,
              date(r.returned_at) as activity_date, r.status as status, 1 as item_count
       FROM returns r
       JOIN loans l ON l.id = r.loan_id
       JOIN members m ON m.id = l.member_id
       ORDER BY activity_date DESC
       LIMIT 10`
    )
    .all();

  // Inventory condition summary
  const conditionSummary = db
    .prepare(
      `SELECT condition, COUNT(*) as count
       FROM book_copies
       WHERE archived_at IS NULL AND status != 'Dihapus'
       GROUP BY condition`
    )
    .all();

  // Circulation timeline (last 10 distinct active dates or last 7 days)
  const loansByDate = db
    .prepare(
      `SELECT loan_date as date, COUNT(*) as loans
       FROM loans
       GROUP BY loan_date
       ORDER BY loan_date DESC
       LIMIT 10`
    )
    .all() as Array<{ date: string; loans: number }>;

  const returnsByDate = db
    .prepare(
      `SELECT date(returned_at) as date, COUNT(*) as returns
       FROM returns
       GROUP BY date(returned_at)
       ORDER BY date(returned_at) DESC
       LIMIT 10`
    )
    .all() as Array<{ date: string; returns: number }>;

  const dateSet = new Set<string>([
    ...loansByDate.map((d) => d.date),
    ...returnsByDate.map((d) => d.date),
  ]);
  const loanMap = new Map(loansByDate.map((d) => [d.date, d.loans]));
  const retMap = new Map(returnsByDate.map((d) => [d.date, d.returns]));
  const circulationTrend = Array.from(dateSet)
    .sort()
    .slice(-8)
    .map((date) => ({
      date,
      loans: loanMap.get(date) || 0,
      returns: retMap.get(date) || 0,
    }));

  return NextResponse.json({
    stats: {
      totalTitles,
      totalCopies,
      availableCopies,
      borrowedCopies,
      overdueItemsCount,
      activeMembers,
      todayTransactions: todayLoans + todayReturns,
      activeReservations,
    },
    popularBooks,
    categoryStats,
    overdueList,
    recentActivity,
    conditionSummary,
    circulationTrend,
  });
}
