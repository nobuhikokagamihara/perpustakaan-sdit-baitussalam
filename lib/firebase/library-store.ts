'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  clampString,
  FIREBASE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  getFirestoreClient,
  handleFirestoreError,
  IS_FIRESTORE_ONLY_MODE,
  OperationType,
  sanitizeDocId,
} from '@/lib/firebase/client';
import {
  FirestoreReadCache,
  formatFirestoreQuotaMessage,
  isFirestoreQuotaError,
} from '@/lib/firebase/read-cache';
import {
  classNameToDocId,
  ensureFirestoreSeeded,
  ROLE_PERMISSION_DEFAULTS,
  SEED_READING_SCHEDULES,
  SEED_SCHOOL_CLASSES,
} from '@/lib/firebase/firestore-seed';
import {
  addDaysIso,
  calculateDueDate,
  calculateFineAmount,
  calculateOverdueDays,
  computeStockOpnameDiscrepancy,
  formatIsoDate,
  validateLoanEligibility,
  validatePaymentAmount,
  validateRenewalEligibility,
  type CopyCondition,
  type CopyStatus,
  type MemberStatus,
} from '@/lib/domain/library-rules';
import {
  ALL_BACKUP_TABLES,
  BACKUP_MODULES,
  DEFAULT_SYSTEM_SETTINGS,
  SYSTEM_ROLE_SLUGS,
  buildBackupEnvelope,
  computeRestoreDiff,
  evaluateBackupHealth,
  extractCirculationPolicy,
  guardSuperAdminLockout,
  normalizeSelectedModules,
  parseNumberSetting,
  validateBackupEnvelope,
  validateCustomRoleInput,
  validateMembershipPolicyInput,
  type BackupModuleId,
} from '@/lib/domain/settings-backup-rules';
import {
  READING_AREAS,
  READING_DAYS,
  SCHEDULE_STATUSES,
  SD_CLASSES,
  buildAutoClassScheduleSlots,
  computeClassAttendanceRecap,
  computeClassCoverage,
  computeScheduleSummary,
  detectScheduleConflict,
  extractGradeLevel,
  getClassPreset,
  summarizeSessionAttendance,
  validateAttendanceEntries,
  validateCompletionLog,
  validateSchedulePayload,
  validateStudentPayload,
  type AttendanceRecordItem,
  type AttendanceStatus,
  type ClassStudentRecord,
  type ReadingScheduleRecord,
  type ScheduleStatus,
} from '@/lib/domain/reading-schedule-rules';
import {
  generateCallNumber,
  validateCoverUrl,
  validateIsbnFormat,
} from '@/lib/domain/book-catalog-rules';

export interface FirebaseSessionActor {
  uid: string;
  email: string;
  fullName: string;
  roleSlug: string;
  roleName: string;
  memberDocId: string | null;
  memberNumericId: number | null;
  permissions: string[];
}

type FsDoc = DocumentData & { id: string };

function tsToIso(val: unknown): string {
  if (!val) return '';
  if (val instanceof Timestamp) {
    return val.toDate().toISOString().replace('T', ' ').slice(0, 19);
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const secs = Number((val as { seconds: number }).seconds || 0);
    return new Date(secs * 1000).toISOString().replace('T', ' ').slice(0, 19);
  }
  return String(val);
}

// Short-TTL in-memory cache to stay comfortably within Firestore Spark Free Tier (50K reads/day).
// Cleared automatically before & after any non-GET mutation in dispatchFirestoreApi.
const readCache = new FirestoreReadCache(25_000, 80);

export function clearFirestoreReadCache(): void {
  readCache.clear();
}

function makeQueryCacheKey(path: string, constraints: ReturnType<typeof where>[]): string | null {
  if (constraints.length === 0) return `col:${path}:*`;
  // Cache common single-constraint queries deterministically
  if (constraints.length === 1) {
    const raw = constraints[0] as unknown as {
      _field?: { segments?: string[] };
      _op?: string;
      _value?: unknown;
    };
    const field = raw?._field?.segments?.join('.');
    if (field && typeof raw._op === 'string') {
      return `col:${path}:${field}:${raw._op}:${String(raw._value)}`;
    }
  }
  return null;
}

async function listCollection(
  path: string,
  constraints: ReturnType<typeof where>[] = []
): Promise<FsDoc[]> {
  const cacheKey = makeQueryCacheKey(path, constraints);
  if (cacheKey) {
    const cached = readCache.get<FsDoc[]>(cacheKey);
    if (cached) return cached;
  }

  const db = getFirestoreClient();
  try {
    const colRef = collection(db, path);
    const qRef = constraints.length > 0 ? query(colRef, ...constraints) : colRef;
    const snap = await getDocs(qRef);
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (cacheKey) {
      readCache.set(cacheKey, docs);
    }
    return docs;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

async function listCategories(): Promise<FsDoc[]> {
  return listCollection('categories', [where('numericId', '>=', 1)]);
}

async function getDocument(path: string, id: string): Promise<FsDoc | null> {
  const cacheKey = `doc:${path}/${id}`;
  const cached = readCache.get<FsDoc | null>(cacheKey);
  if (cached !== undefined) return cached;

  const db = getFirestoreClient();
  try {
    const snap = await getDoc(doc(db, path, id));
    const result = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    readCache.set(cacheKey, result);
    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `${path}/${id}`);
  }
}

function nextNumericId(docs: FsDoc[]): number {
  let max = 0;
  for (const d of docs) {
    const n = Number(d.numericId || 0);
    if (n > max) max = n;
  }
  return max + 1;
}

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isStaffRole(roleSlug: string) {
  return ['super_admin', 'kepala_perpustakaan', 'pustakawan'].includes(roleSlug);
}

async function writeAuditLog(
  actor: FirebaseSessionActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
) {
  const db = getFirestoreClient();
  const logId = sanitizeDocId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      userUid: clampString(actor.uid, 128, 'system'),
      userName: clampString(actor.fullName, 120, 'Petugas'),
      action: clampString(action, 80, 'ACTION'),
      entityType: clampString(entityType, 64, 'system'),
      entityId: clampString(entityId, 128, '-'),
      summary: clampString(summary, 500, ''),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `audit_logs/${logId}`);
  }
}

async function syncPublicCatalogForBook(bookDocId: string) {
  const db = getFirestoreClient();
  const book = await getDocument('books', bookDocId);
  if (!book) return;
  const allCopies = await listCollection('book_copies', [where('bookId', '==', bookDocId)]);
  const activeCopies = allCopies.filter((c) => !c.archived && c.status !== 'Dihapus');
  const availableCopies = activeCopies.filter((c) => c.status === 'Tersedia').length;
  const shelfCodes = Array.from(
    new Set(activeCopies.map((c) => String(c.shelfCode || '')).filter(Boolean))
  ).join(', ');

  const pubRef = doc(db, 'public_catalog', bookDocId);
  const existingPub = await getDocument('public_catalog', bookDocId);
  const payload = {
    numericId: Number(book.numericId || 1),
    title: clampString(book.title, 240, 'Tanpa Judul'),
    subtitle: clampString(book.subtitle, 240, ''),
    seriesName: clampString(book.seriesName, 160, ''),
    volume: clampString(book.volume, 60, ''),
    isbn: clampString(book.isbn, 40, ''),
    edition: clampString(book.edition, 80, ''),
    publishYear: Number(book.publishYear || 2025),
    publishCity: clampString(book.publishCity, 100, ''),
    language: clampString(book.language, 60, 'Indonesia'),
    description: clampString(book.description, 2000, ''),
    tableOfContents: clampString(book.tableOfContents, 2000, ''),
    pages: Number(book.pages || 0),
    dimensions: clampString(book.dimensions, 80, ''),
    bindingType: clampString(book.bindingType, 80, ''),
    illustrationNotes: clampString(book.illustrationNotes, 160, ''),
    coverUrl: clampString(book.coverUrl, 1000, ''),
    categoryId: clampString(book.categoryId, 128, ''),
    categoryName: clampString(book.categoryName, 120, ''),
    publisherName: clampString(book.publisherName, 120, ''),
    authors: clampString(book.authors, 200, ''),
    illustrator: clampString(book.illustrator, 160, ''),
    editor: clampString(book.editor, 160, ''),
    translator: clampString(book.translator, 160, ''),
    subcategory: clampString(book.subcategory, 120, ''),
    ddcCode: clampString(book.ddcCode, 40, ''),
    callNumber: clampString(book.callNumber, 60, ''),
    subjects: clampString(book.subjects, 300, ''),
    targetGrade: clampString(book.targetGrade, 80, ''),
    ageRange: clampString(book.ageRange, 60, ''),
    isReferenceOnly: Boolean(book.isReferenceOnly),
    readInPlaceOnly: Boolean(book.readInPlaceOnly),
    isFeatured: Boolean(book.isFeatured),
    totalCopies: activeCopies.length,
    availableCopies,
    shelfLocations: clampString(shelfCodes, 240, ''),
    borrowCount: Number(book.borrowCount || 0),
    archived: Boolean(book.archived),
    updatedAt: serverTimestamp(),
  };

  try {
    if (existingPub) {
      await updateDoc(pubRef, payload);
    } else {
      await setDoc(pubRef, { ...payload, createdAt: serverTimestamp() });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `public_catalog/${bookDocId}`);
  }
}

export async function fetchFirestoreCatalogPublic(
  q = '',
  categoryId = '',
  isAuthenticated = false
) {
  if (!isAuthenticated) {
    try {
      const globalSet = await getDocument('library_settings', 'global');
      const policy = extractCirculationPolicy(
        (globalSet?.values as Record<string, string>) || {}
      );
      if (!policy.enableOpacPublic) {
        return {
          opacDisabled: true,
          books: [],
          categories: [],
          newest: [],
          mostBorrowed: [],
        };
      }
    } catch {
      // Allow catalog fallback if global settings doc is unreadable
    }
  }

  const catalogDocs = await listCollection('public_catalog', [where('archived', '==', false)]);

  if (catalogDocs.length === 0) {
    return null; // Not seeded yet in Firestore; caller may fall back cleanly
  }

  const categoryDocs = await listCategories();

  const term = q.trim().toLowerCase();
  const mapped = catalogDocs
    .map((b) => ({
      id: Number(b.numericId),
      docId: b.id,
      title: String(b.title || ''),
      subtitle: String(b.subtitle || ''),
      series_name: String(b.seriesName || ''),
      volume: String(b.volume || ''),
      isbn: String(b.isbn || ''),
      edition: String(b.edition || ''),
      publish_year: Number(b.publishYear || 2025),
      publish_city: String(b.publishCity || ''),
      language: String(b.language || 'Indonesia'),
      description: String(b.description || ''),
      table_of_contents: String(b.tableOfContents || ''),
      pages: Number(b.pages || 0),
      dimensions: String(b.dimensions || ''),
      binding_type: String(b.bindingType || ''),
      illustration_notes: String(b.illustrationNotes || ''),
      cover_url: String(b.coverUrl || ''),
      subcategory: String(b.subcategory || ''),
      ddc_code: String(b.ddcCode || ''),
      call_number: String(b.callNumber || ''),
      subjects: String(b.subjects || ''),
      target_grade: String(b.targetGrade || ''),
      age_range: String(b.ageRange || ''),
      illustrator: String(b.illustrator || ''),
      editor: String(b.editor || ''),
      translator: String(b.translator || ''),
      is_reference_only: b.isReferenceOnly ? 1 : 0,
      read_in_place_only: b.readInPlaceOnly ? 1 : 0,
      is_featured: b.isFeatured ? 1 : 0,
      category_id: b.categoryId ? Number(String(b.categoryId).replace('cat_', '')) || 0 : 0,
      category_doc_id: String(b.categoryId || ''),
      category_name: String(b.categoryName || ''),
      publisher_name: String(b.publisherName || ''),
      authors: String(b.authors || ''),
      total_copies: Number(b.totalCopies || 0),
      available_copies: Number(b.availableCopies || 0),
      shelf_locations: String(b.shelfLocations || ''),
      borrow_count: Number(b.borrowCount || 0),
    }))
    .filter((b) => {
      if (categoryId) {
        const matchesCat =
          String(b.category_id) === categoryId || b.category_doc_id === categoryId;
        if (!matchesCat) return false;
      }
      if (!term) return true;
      return (
        b.title.toLowerCase().includes(term) ||
        b.subtitle.toLowerCase().includes(term) ||
        b.authors.toLowerCase().includes(term) ||
        b.isbn.toLowerCase().includes(term) ||
        b.ddc_code.toLowerCase().includes(term) ||
        b.call_number.toLowerCase().includes(term) ||
        b.subjects.toLowerCase().includes(term) ||
        b.description.toLowerCase().includes(term)
      );
    });

  const newest = [...mapped].sort((a, b) => b.id - a.id).slice(0, 6);
  const mostBorrowed = [...mapped].sort((a, b) => b.borrow_count - a.borrow_count).slice(0, 6);
  const categories = categoryDocs
    .sort((a, b) => Number(a.numericId) - Number(b.numericId))
    .map((c) => ({
      id: Number(c.numericId),
      docId: c.id,
      name: String(c.name || ''),
    }));

  return { books: mapped, categories, newest, mostBorrowed };
}

export async function dispatchFirestoreApi(
  urlStr: string,
  method: string,
  body: Record<string, unknown> | null,
  actor: FirebaseSessionActor
): Promise<Response> {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== 'GET') {
    readCache.clear();
  }
  try {
    const res = await dispatchFirestoreApiInner(urlStr, upperMethod, body, actor);
    if (upperMethod !== 'GET') {
      readCache.clear();
    }
    return res;
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return jsonRes(
        { error: formatFirestoreQuotaMessage(FIREBASE_PROJECT_ID, FIREBASE_DATABASE_ID) },
        429
      );
    }
    throw err;
  }
}

async function dispatchFirestoreApiInner(
  urlStr: string,
  method: string,
  body: Record<string, unknown> | null,
  actor: FirebaseSessionActor
): Promise<Response> {
  const url = new URL(urlStr, 'http://localhost:3000');
  const pathname = url.pathname;
  const searchParams = url.searchParams;
  const db = getFirestoreClient();
  const isStaff = isStaffRole(actor.roleSlug);
  const todayStr = formatIsoDate(new Date());

  // Seed Firestore automatically on first staff login if needed
  if (isStaff) {
    await ensureFirestoreSeeded(actor.uid, actor.fullName);
  }

  // 1. /api/catalog
  if (pathname === '/api/catalog' && method === 'GET') {
    const q = searchParams.get('q') || '';
    const categoryId = searchParams.get('categoryId') || '';
    const res = await fetchFirestoreCatalogPublic(q, categoryId, true);
    if (!res) {
      if (IS_FIRESTORE_ONLY_MODE) {
        return jsonRes({ books: [], categories: [], newest: [], mostBorrowed: [] });
      }
      // Fallback to SQLite API if unseeded in hybrid mode
      return fetch(urlStr, { cache: 'no-store' });
    }
    return jsonRes(res);
  }

  // 2. /api/dashboard
  if (pathname === '/api/dashboard' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const [books, copies, members, loans, returns, reservations, categories] = await Promise.all([
      listCollection('books', [where('archived', '==', false)]),
      listCollection('book_copies', [where('archived', '==', false)]),
      listCollection('members', [where('archived', '==', false)]),
      listCollection('loans'),
      listCollection('returns'),
      listCollection('reservations'),
      listCategories(),
    ]);

    const activeCopies = copies.filter((c) => c.status !== 'Dihapus');
    const availableCopies = activeCopies.filter((c) => c.status === 'Tersedia').length;
    const borrowedCopies = activeCopies.filter((c) => c.status === 'Dipinjam').length;
    const activeMembers = members.filter((m) => m.status === 'Aktif').length;
    const activeReservations = reservations.filter(
      (r) => r.status === 'Menunggu' || r.status === 'Tersedia'
    ).length;

    const overdueList: Array<Record<string, unknown>> = [];
    for (const l of loans) {
      const items = (l.items as Array<Record<string, unknown>>) || [];
      for (const it of items) {
        if (!it.returnedAt && String(it.dueDate || l.dueDate) < todayStr) {
          overdueList.push({
            loan_item_id: Number(it.id || 1),
            loan_number: String(l.loanNumber || ''),
            due_date: String(it.dueDate || l.dueDate),
            member_name: String(l.memberName || ''),
            member_code: String(l.memberCode || ''),
            book_title: String(it.bookTitle || ''),
            inventory_code: String(it.inventoryCode || ''),
          });
        }
      }
    }

    const todayTransactions =
      loans.filter((l) => l.loanDate === todayStr).length +
      returns.filter((r) => r.returnedAt === todayStr).length;

    const popularBooks = [...books]
      .sort((a, b) => Number(b.borrowCount || 0) - Number(a.borrowCount || 0))
      .slice(0, 6)
      .map((b) => ({
        id: Number(b.numericId),
        title: String(b.title),
        isbn: String(b.isbn || ''),
        category_name: String(b.categoryName || ''),
        borrow_count: Number(b.borrowCount || 0),
        available_count: activeCopies.filter(
          (c) => c.bookId === b.id && c.status === 'Tersedia'
        ).length,
      }));

    const categoryStats = categories.map((cat) => {
      const catBooks = books.filter((b) => b.categoryId === cat.id);
      const loansCount = catBooks.reduce((s, b) => s + Number(b.borrowCount || 0), 0);
      return {
        category: String(cat.name),
        titles_count: catBooks.length,
        loans_count: loansCount,
      };
    });

    const condCounts = new Map<string, number>();
    for (const c of activeCopies) {
      const cond = String(c.condition || 'Baik');
      condCounts.set(cond, (condCounts.get(cond) || 0) + 1);
    }
    const conditionSummary = Array.from(condCounts.entries()).map(([condition, count]) => ({
      condition,
      count,
    }));

    const trendMap = new Map<string, { loans: number; returns: number }>();
    for (const l of loans) {
      const d = String(l.loanDate || '');
      if (!d) continue;
      const cur = trendMap.get(d) || { loans: 0, returns: 0 };
      cur.loans++;
      trendMap.set(d, cur);
    }
    for (const r of returns) {
      const d = String(r.returnedAt || '');
      if (!d) continue;
      const cur = trendMap.get(d) || { loans: 0, returns: 0 };
      cur.returns++;
      trendMap.set(d, cur);
    }
    const circulationTrend = Array.from(trendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([date, val]) => ({ date, loans: val.loans, returns: val.returns }));

    const recentActivity = [
      ...loans.map((l) => ({
        type: 'Peminjaman',
        ref_number: String(l.loanNumber),
        member_name: String(l.memberName),
        activity_date: String(l.loanDate),
        status: String(l.status),
        item_count: Array.isArray(l.items) ? l.items.length : 1,
      })),
      ...returns.map((r) => ({
        type: 'Pengembalian',
        ref_number: String(r.returnNumber),
        member_name: String(r.memberName),
        activity_date: String(r.returnedAt),
        status: String(r.status),
        item_count: 1,
      })),
    ]
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date))
      .slice(0, 8);

    return jsonRes({
      stats: {
        totalTitles: books.length,
        totalCopies: activeCopies.length,
        availableCopies,
        borrowedCopies,
        overdueItemsCount: overdueList.length,
        activeMembers,
        todayTransactions,
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

  // 3. /api/books & /api/books/[id] & /api/books/import
  if (pathname === '/api/books' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const catFilter = searchParams.get('categoryId') || '';
    const sortBy = searchParams.get('sortBy') || 'created_at';

    const [books, copies, categories, shelves] = await Promise.all([
      listCollection('books', [where('archived', '==', false)]),
      listCollection('book_copies', [where('archived', '==', false)]),
      listCategories(),
      listCollection('shelves'),
    ]);

    let rows = books.map((b) => {
      const bCopies = copies.filter((c) => c.bookId === b.id && c.status !== 'Dihapus');
      const avail = bCopies.filter((c) => c.status === 'Tersedia').length;
      const shelfCodes = Array.from(
        new Set(bCopies.map((c) => String(c.shelfCode || '')).filter(Boolean))
      ).join(', ');
      return {
        id: Number(b.numericId),
        docId: b.id,
        title: String(b.title || ''),
        subtitle: String(b.subtitle || ''),
        series_name: String(b.seriesName || ''),
        volume: String(b.volume || ''),
        isbn: String(b.isbn || ''),
        edition: String(b.edition || ''),
        publish_year: Number(b.publishYear || 2025),
        publish_city: String(b.publishCity || ''),
        language: String(b.language || 'Indonesia'),
        description: String(b.description || ''),
        table_of_contents: String(b.tableOfContents || ''),
        pages: Number(b.pages || 0),
        dimensions: String(b.dimensions || ''),
        binding_type: String(b.bindingType || 'Softcover (Art Carton)'),
        paper_type: String(b.paperType || ''),
        weight_grams: Number(b.weightGrams || 0),
        illustration_notes: String(b.illustrationNotes || ''),
        cover_url: String(b.coverUrl || ''),
        price: Number(b.price || 0),
        category_id: b.categoryId ? Number(String(b.categoryId).replace('cat_', '')) || null : null,
        category_doc_id: String(b.categoryId || ''),
        category_name: String(b.categoryName || ''),
        publisher_name: String(b.publisherName || ''),
        authors: String(b.authors || ''),
        illustrator: String(b.illustrator || ''),
        editor: String(b.editor || ''),
        translator: String(b.translator || ''),
        subcategory: String(b.subcategory || ''),
        ddc_code: String(b.ddcCode || ''),
        call_number: String(b.callNumber || ''),
        subjects: String(b.subjects || ''),
        target_grade: String(b.targetGrade || 'Semua Kelas (1–6 SD)'),
        age_range: String(b.ageRange || ''),
        acquisition_source: String(b.acquisitionSource || 'Pembelian Dana BOS'),
        acquisition_date: String(b.acquisitionDate || ''),
        is_reference_only: b.isReferenceOnly ? 1 : 0,
        read_in_place_only: b.readInPlaceOnly ? 1 : 0,
        is_featured: b.isFeatured ? 1 : 0,
        total_copies: bCopies.length,
        available_copies: avail,
        primary_shelf: shelfCodes || '-',
        _invCodes: bCopies.map((c) => String(c.inventoryCode || '').toLowerCase()),
      };
    });

    if (catFilter) {
      rows = rows.filter(
        (r) => String(r.category_id) === catFilter || r.category_doc_id === catFilter
      );
    }
    if (q) {
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.subtitle.toLowerCase().includes(q) ||
          r.isbn.toLowerCase().includes(q) ||
          r.authors.toLowerCase().includes(q) ||
          r.ddc_code.toLowerCase().includes(q) ||
          r.call_number.toLowerCase().includes(q) ||
          r.subjects.toLowerCase().includes(q) ||
          r._invCodes.some((code) => code.includes(q))
      );
    }

    if (sortBy === 'title') rows.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === 'publish_year') rows.sort((a, b) => b.publish_year - a.publish_year);
    else if (sortBy === 'price') rows.sort((a, b) => b.price - a.price);
    else rows.sort((a, b) => b.id - a.id);

    return jsonRes({
      books: rows,
      categories: categories
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((c) => ({ id: Number(c.numericId), docId: c.id, name: String(c.name) })),
      shelves: shelves
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((s) => ({
          id: Number(s.numericId),
          docId: s.id,
          code: String(s.code),
          name: String(s.name),
        })),
    });
  }

  if (pathname === '/api/books' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const title = clampString(body?.title, 240);
    const authors = clampString(body?.authors, 200);
    if (!title || !authors) {
      return jsonRes({ error: 'Judul buku dan penulis wajib diisi.' }, 400);
    }
    const isbnCheck = validateIsbnFormat(String(body?.isbn || ''));
    if (!isbnCheck.valid) {
      return jsonRes({ error: isbnCheck.reason || 'Format ISBN tidak valid.' }, 400);
    }
    const coverCheck = validateCoverUrl(String(body?.coverUrl || ''));
    if (!coverCheck.valid) {
      return jsonRes({ error: coverCheck.reason || 'Format link cover tidak valid.' }, 400);
    }

    const [books, copies, categories, shelves] = await Promise.all([
      listCollection('books'),
      listCollection('book_copies'),
      listCategories(),
      listCollection('shelves'),
    ]);
    if (isbnCheck.normalized && books.some((b) => String(b.isbn || '') === isbnCheck.normalized)) {
      return jsonRes({ error: `ISBN ${isbnCheck.normalized} sudah terdaftar pada koleksi.` }, 409);
    }

    const nextBookNum = nextNumericId(books);
    const bookDocId = `book_${nextBookNum}`;
    let nextCopyNum = nextNumericId(copies);

    const catMatch = categories.find(
      (c) => String(c.numericId) === String(body?.categoryId || '') || c.id === String(body?.categoryId || '')
    );
    const shelfMatch = shelves.find(
      (s) => String(s.numericId) === String(body?.shelfId || '') || s.id === String(body?.shelfId || '')
    );
    const copiesCount = Math.min(50, Math.max(1, Number(body?.copiesCount || 1)));
    const price = Math.max(0, Number(body?.price || 50000));
    const weightGrams = Math.max(0, Math.min(20000, Number(body?.weightGrams || 0)));
    const isRef = Boolean(body?.isReferenceOnly);
    const readInPlace = Boolean(body?.readInPlaceOnly);
    const isFeatured = Boolean(body?.isFeatured);
    const ddcCode = clampString(body?.ddcCode, 40, '');
    const callNumber =
      clampString(body?.callNumber, 60, '') ||
      (ddcCode ? generateCallNumber({ ddcCode, authors, title }) : '');
    const coverUrl = coverCheck.normalized;
    const acqDate = clampString(body?.acquisitionDate, 32, todayStr);
    const copyCondition = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'].includes(String(body?.condition || ''))
      ? String(body?.condition)
      : 'Baik';

    const sharedBookMeta = {
      numericId: nextBookNum,
      title,
      subtitle: clampString(body?.subtitle, 240, ''),
      seriesName: clampString(body?.seriesName, 160, ''),
      volume: clampString(body?.volume, 60, ''),
      isbn: isbnCheck.normalized,
      edition: clampString(body?.edition, 80, 'Cetakan 1'),
      publishYear: Number(body?.publishYear || 2025),
      publishCity: clampString(body?.publishCity, 100, ''),
      language: clampString(body?.language, 60, 'Indonesia'),
      description: clampString(body?.description, 2000, ''),
      tableOfContents: clampString(body?.tableOfContents, 2000, ''),
      pages: Math.max(0, Number(body?.pages || 0)),
      dimensions: clampString(body?.dimensions, 80, ''),
      bindingType: clampString(body?.bindingType, 80, 'Softcover (Art Carton)'),
      illustrationNotes: clampString(body?.illustrationNotes, 160, ''),
      coverUrl,
      categoryId: catMatch ? catMatch.id : '',
      categoryName: catMatch ? clampString(catMatch.name, 120) : '',
      publisherName: clampString(body?.publisher, 120, 'Pustaka Sekolah'),
      authors,
      illustrator: clampString(body?.illustrator, 160, ''),
      editor: clampString(body?.editor, 160, ''),
      translator: clampString(body?.translator, 160, ''),
      subcategory: clampString(body?.subcategory, 120, ''),
      ddcCode,
      callNumber,
      subjects: clampString(body?.subjects, 300, ''),
      targetGrade: clampString(body?.targetGrade, 80, 'Semua Kelas (1–6 SD)'),
      ageRange: clampString(body?.ageRange, 60, ''),
      isReferenceOnly: isRef,
      readInPlaceOnly: readInPlace,
      isFeatured,
      borrowCount: 0,
      archived: false,
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'books', bookDocId), {
      ...sharedBookMeta,
      paperType: clampString(body?.paperType, 80, ''),
      weightGrams,
      price,
      acquisitionSource: clampString(body?.acquisitionSource, 120, 'Pembelian Dana BOS'),
      acquisitionDate: acqDate,
      createdByUid: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'public_catalog', bookDocId), {
      ...sharedBookMeta,
      totalCopies: copiesCount,
      availableCopies: copiesCount,
      shelfLocations: shelfMatch ? `${shelfMatch.code} (${shelfMatch.name})` : '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < copiesCount; i++) {
      const cNum = nextCopyNum++;
      const invCode =
        i === 0 && body?.inventoryCode
          ? clampString(body.inventoryCode, 64)
          : `LP-2026-${String(cNum).padStart(4, '0')}`;
      batch.set(doc(db, 'book_copies', `copy_${cNum}`), {
        numericId: cNum,
        bookId: bookDocId,
        bookTitle: title,
        inventoryCode: invCode,
        barcode: `BC${String(20260000 + cNum)}`,
        shelfId: shelfMatch ? shelfMatch.id : '',
        shelfCode: shelfMatch ? clampString(shelfMatch.code, 64) : '',
        shelfName: shelfMatch ? clampString(shelfMatch.name, 120) : '',
        condition: copyCondition,
        status: 'Tersedia',
        acquisitionDate: acqDate,
        price,
        notes: clampString(body?.copyNotes || body?.notes, 500, ''),
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      await writeAuditLog(actor, 'BOOK_CREATE', 'books', bookDocId, `Tambah buku: ${title} (${copiesCount} eks)`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `books/${bookDocId}`);
    }
    return jsonRes({ ok: true, id: nextBookNum, docId: bookDocId });
  }

  const bookIdMatch = pathname.match(/^\/api\/books\/([^/]+)$/);
  if (bookIdMatch && bookIdMatch[1] !== 'import') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const idParam = bookIdMatch[1];
    const bookDocId = idParam.startsWith('book_') ? idParam : `book_${idParam}`;
    const book = await getDocument('books', bookDocId);
    if (!book) return jsonRes({ error: 'Buku tidak ditemukan.' }, 404);

    if (method === 'GET') {
      const [copies, loans] = await Promise.all([
        listCollection('book_copies', [where('bookId', '==', bookDocId)]),
        listCollection('loans'),
      ]);
      const copyIdsSet = new Set(copies.map((c) => c.id));
      const history: Array<Record<string, unknown>> = [];
      for (const l of loans) {
        const items = (l.items as Array<Record<string, unknown>>) || [];
        for (const it of items) {
          if (copyIdsSet.has(String(it.copyId))) {
            history.push({
              id: `${l.id}_${it.id}`,
              loan_number: l.loanNumber,
              inventory_code: it.inventoryCode,
              member_name: l.memberName,
              loan_date: l.loanDate,
              status: it.status,
            });
          }
        }
      }
      return jsonRes({
        book: {
          id: Number(book.numericId),
          title: book.title,
          subtitle: String(book.subtitle || ''),
          series_name: String(book.seriesName || ''),
          volume: String(book.volume || ''),
          isbn: book.isbn,
          edition: book.edition,
          publish_year: book.publishYear,
          publish_city: String(book.publishCity || ''),
          language: book.language,
          description: book.description,
          table_of_contents: String(book.tableOfContents || ''),
          pages: book.pages,
          dimensions: String(book.dimensions || ''),
          binding_type: String(book.bindingType || 'Softcover (Art Carton)'),
          paper_type: String(book.paperType || ''),
          weight_grams: Number(book.weightGrams || 0),
          illustration_notes: String(book.illustrationNotes || ''),
          cover_url: book.coverUrl,
          price: book.price,
          category_id: book.categoryId ? Number(String(book.categoryId).replace('cat_', '')) || null : null,
          category_name: book.categoryName,
          publisher_name: book.publisherName,
          authors: book.authors,
          illustrator: String(book.illustrator || ''),
          editor: String(book.editor || ''),
          translator: String(book.translator || ''),
          subcategory: String(book.subcategory || ''),
          ddc_code: String(book.ddcCode || ''),
          call_number: String(book.callNumber || ''),
          subjects: String(book.subjects || ''),
          target_grade: String(book.targetGrade || 'Semua Kelas (1–6 SD)'),
          age_range: String(book.ageRange || ''),
          acquisition_source: String(book.acquisitionSource || 'Pembelian Dana BOS'),
          acquisition_date: String(book.acquisitionDate || ''),
          is_reference_only: book.isReferenceOnly ? 1 : 0,
          read_in_place_only: book.readInPlaceOnly ? 1 : 0,
          is_featured: book.isFeatured ? 1 : 0,
        },
        copies: copies
          .filter((c) => !c.archived)
          .map((c) => ({
            id: Number(c.numericId),
            docId: c.id,
            inventory_code: c.inventoryCode,
            barcode: c.barcode,
            condition: c.condition,
            status: c.status,
            shelf_code: c.shelfCode || '-',
            shelf_name: c.shelfName || '-',
          })),
        history,
      });
    }

    if (method === 'PUT') {
      const title = clampString(body?.title, 240);
      const authors = clampString(body?.authors, 200);
      if (!title || !authors) return jsonRes({ error: 'Judul dan penulis wajib diisi.' }, 400);
      const isbnCheck = validateIsbnFormat(String(body?.isbn || ''));
      if (!isbnCheck.valid) {
        return jsonRes({ error: isbnCheck.reason || 'Format ISBN tidak valid.' }, 400);
      }
      const coverCheck = validateCoverUrl(
        body?.coverUrl !== undefined ? String(body.coverUrl) : String(book.coverUrl || '')
      );
      if (!coverCheck.valid) {
        return jsonRes({ error: coverCheck.reason || 'Format link cover tidak valid.' }, 400);
      }

      const categories = await listCategories();
      const catMatch = categories.find(
        (c) => String(c.numericId) === String(body?.categoryId || '') || c.id === String(body?.categoryId || '')
      );
      const isRef = Boolean(body?.isReferenceOnly);
      try {
        await updateDoc(doc(db, 'books', bookDocId), {
          title,
          subtitle: clampString(body?.subtitle, 240, ''),
          seriesName: clampString(body?.seriesName, 160, ''),
          volume: clampString(body?.volume, 60, ''),
          isbn: isbnCheck.normalized,
          edition: clampString(body?.edition, 80, String(book.edition || 'Cetakan 1')),
          publishYear: Number(body?.publishYear || book.publishYear || 2025),
          publishCity: clampString(body?.publishCity, 100, ''),
          language: clampString(body?.language, 60, String(book.language || 'Indonesia')),
          pages: Math.max(0, Number(body?.pages || book.pages || 0)),
          dimensions: clampString(body?.dimensions, 80, ''),
          bindingType: clampString(body?.bindingType, 80, String(book.bindingType || 'Softcover (Art Carton)')),
          paperType: clampString(body?.paperType, 80, ''),
          weightGrams: Math.max(0, Math.min(20000, Number(body?.weightGrams ?? book.weightGrams ?? 0))),
          illustrationNotes: clampString(body?.illustrationNotes, 160, ''),
          coverUrl: coverCheck.normalized,
          price: Math.max(0, Number(body?.price ?? book.price ?? 0)),
          categoryId: catMatch ? catMatch.id : String(book.categoryId || ''),
          categoryName: catMatch ? clampString(catMatch.name, 120) : String(book.categoryName || ''),
          publisherName: clampString(body?.publisher, 120, String(book.publisherName || '')),
          authors,
          illustrator: clampString(body?.illustrator, 160, ''),
          editor: clampString(body?.editor, 160, ''),
          translator: clampString(body?.translator, 160, ''),
          subcategory: clampString(body?.subcategory, 120, ''),
          ddcCode: clampString(body?.ddcCode, 40, ''),
          callNumber: clampString(body?.callNumber, 60, ''),
          subjects: clampString(body?.subjects, 300, ''),
          targetGrade: clampString(body?.targetGrade, 80, String(book.targetGrade || 'Semua Kelas (1–6 SD)')),
          ageRange: clampString(body?.ageRange, 60, ''),
          acquisitionSource: clampString(body?.acquisitionSource, 120, String(book.acquisitionSource || 'Pembelian Dana BOS')),
          acquisitionDate: clampString(body?.acquisitionDate, 32, String(book.acquisitionDate || todayStr)),
          description: clampString(body?.description, 2000, ''),
          tableOfContents: clampString(body?.tableOfContents, 2000, ''),
          isReferenceOnly: isRef,
          readInPlaceOnly: Boolean(body?.readInPlaceOnly),
          isFeatured: Boolean(body?.isFeatured),
          updatedAt: serverTimestamp(),
        });
        await syncPublicCatalogForBook(bookDocId);
        await writeAuditLog(actor, 'BOOK_UPDATE', 'books', bookDocId, `Perbarui buku: ${title}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `books/${bookDocId}`);
      }
      return jsonRes({ ok: true });
    }

    if (method === 'PATCH' && body?.action === 'add_copies') {
      const count = Math.min(20, Math.max(1, Number(body?.count || 1)));
      const [copies, shelves] = await Promise.all([
        listCollection('book_copies'),
        listCollection('shelves'),
      ]);
      let nextCopyNum = nextNumericId(copies);
      const shelfMatch = shelves.find(
        (s) => String(s.numericId) === String(body?.shelfId || '') || s.id === String(body?.shelfId || '')
      ) || shelves[0];

      const batch = writeBatch(db);
      for (let i = 0; i < count; i++) {
        const cNum = nextCopyNum++;
        batch.set(doc(db, 'book_copies', `copy_${cNum}`), {
          numericId: cNum,
          bookId: bookDocId,
          bookTitle: clampString(book.title, 240),
          inventoryCode: `LP-2026-${String(cNum).padStart(4, '0')}`,
          barcode: `BC${String(20260000 + cNum)}`,
          shelfId: shelfMatch ? shelfMatch.id : '',
          shelfCode: shelfMatch ? clampString(shelfMatch.code, 64) : '',
          shelfName: shelfMatch ? clampString(shelfMatch.name, 120) : '',
          condition: 'Baik',
          status: 'Tersedia',
          acquisitionDate: todayStr,
          price: Number(book.price || 50000),
          notes: '',
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
        await syncPublicCatalogForBook(bookDocId);
        await writeAuditLog(actor, 'BOOK_ADD_COPIES', 'books', bookDocId, `Tambah ${count} eksemplar`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `book_copies`);
      }
      return jsonRes({ ok: true });
    }

    if (method === 'DELETE') {
      const copies = await listCollection('book_copies', [where('bookId', '==', bookDocId)]);
      const hasBorrowed = copies.some((c) => c.status === 'Dipinjam' || c.status === 'Direservasi');
      if (hasBorrowed) {
        return jsonRes(
          { error: 'Buku masih memiliki eksemplar yang sedang dipinjam atau direservasi.' },
          409
        );
      }
      try {
        await updateDoc(doc(db, 'books', bookDocId), {
          archived: true,
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'public_catalog', bookDocId), {
          archived: true,
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(actor, 'BOOK_ARCHIVE', 'books', bookDocId, `Arsipkan buku: ${book.title}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `books/${bookDocId}`);
      }
      return jsonRes({ ok: true });
    }
  }

  if (pathname === '/api/books/import' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const mode = String(body?.mode || 'preview');
    const rawRows = (body?.rows as Array<Record<string, unknown>>) || [];
    const evaluated = rawRows.map((r, i) => {
      const title = clampString(r.title || r.Judul || r.judul, 240);
      const subtitle = clampString(r.subtitle || r.Subjudul, 240);
      const isbn = clampString(r.isbn || r.ISBN, 40);
      const authors = clampString(r.authors || r.Penulis || r.penulis, 200);
      const coverUrlRaw = clampString(r.coverUrl || r.cover_url || r.Cover || r.LinkCover, 1000);
      const coverCheck = validateCoverUrl(coverUrlRaw);
      const errors: string[] = [];
      if (!title) errors.push('Judul kosong');
      if (!authors) errors.push('Penulis kosong');
      if (!coverCheck.valid) errors.push(coverCheck.reason || 'Link cover tidak valid');
      return {
        rowNumber: i + 1,
        title,
        subtitle,
        isbn,
        authors,
        publisher: clampString(r.publisher || r.Penerbit, 120, 'Pustaka Sekolah'),
        publishYear: Number(r.publishYear || r.Tahun || 2025) || 2025,
        category: clampString(r.category || r.Kategori, 120),
        ddcCode: clampString(r.ddcCode || r.ddc_code || r.DDC, 40),
        callNumber: clampString(r.callNumber || r.call_number || r.NomorPanggil, 60),
        targetGrade: clampString(r.targetGrade || r.target_grade || r.TargetKelas, 80, 'Semua Kelas (1–6 SD)'),
        language: clampString(r.language || r.Bahasa, 60, 'Indonesia'),
        pages: Math.max(0, Number(r.pages || r.Halaman || 80) || 80),
        description: clampString(r.description || r.Sinopsis, 2000),
        coverUrl: coverCheck.valid && coverCheck.normalized ? coverCheck.normalized : '/images/cover-cerita-anak.jpg',
        price: Number(r.price || r.Harga || 60000) || 60000,
        copies: Math.min(20, Math.max(1, Number(r.copies || r.Eksemplar || 1) || 1)),
        valid: errors.length === 0,
        errors,
      };
    });

    if (mode === 'preview') {
      const validCount = evaluated.filter((r) => r.valid).length;
      return jsonRes({
        total: evaluated.length,
        validCount,
        invalidCount: evaluated.length - validCount,
        rows: evaluated,
      });
    }

    const skipInvalid = Boolean(body?.skipInvalid ?? true);
    const toImport = skipInvalid ? evaluated.filter((r) => r.valid) : evaluated;
    if (!skipInvalid && evaluated.some((r) => !r.valid)) {
      return jsonRes({ error: 'Masih ada baris tidak valid.' }, 400);
    }

    const [books, copies, categories, shelves] = await Promise.all([
      listCollection('books'),
      listCollection('book_copies'),
      listCategories(),
      listCollection('shelves'),
    ]);
    let nextBookNum = nextNumericId(books);
    let nextCopyNum = nextNumericId(copies);
    const defaultShelf = shelves[0];

    const batch = writeBatch(db);
    for (const r of toImport) {
      const bNum = nextBookNum++;
      const bookDocId = `book_${bNum}`;
      const cat =
        categories.find((c) => String(c.name).toLowerCase() === r.category.toLowerCase()) ||
        categories[0];

      batch.set(doc(db, 'books', bookDocId), {
        numericId: bNum,
        title: r.title,
        subtitle: r.subtitle,
        isbn: r.isbn,
        edition: 'Import Koleksi',
        publishYear: r.publishYear,
        language: r.language,
        description: r.description || `Koleksi perpustakaan SD (${r.title}).`,
        pages: r.pages,
        coverUrl: r.coverUrl,
        price: r.price,
        categoryId: cat ? cat.id : '',
        categoryName: cat ? clampString(cat.name, 120) : '',
        publisherName: r.publisher,
        authors: r.authors,
        subcategory: '',
        ddcCode: r.ddcCode,
        callNumber: r.callNumber,
        targetGrade: r.targetGrade,
        isReferenceOnly: false,
        readInPlaceOnly: false,
        acquisitionDate: todayStr,
        borrowCount: 0,
        archived: false,
        createdByUid: actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, 'public_catalog', bookDocId), {
        numericId: bNum,
        title: r.title,
        subtitle: r.subtitle,
        isbn: r.isbn,
        edition: 'Import Koleksi',
        publishYear: r.publishYear,
        language: r.language,
        description: r.description || `Koleksi perpustakaan SD (${r.title}).`,
        pages: r.pages,
        coverUrl: r.coverUrl,
        categoryId: cat ? cat.id : '',
        categoryName: cat ? clampString(cat.name, 120) : '',
        publisherName: r.publisher,
        authors: r.authors,
        subcategory: '',
        ddcCode: r.ddcCode,
        callNumber: r.callNumber,
        targetGrade: r.targetGrade,
        isReferenceOnly: false,
        readInPlaceOnly: false,
        totalCopies: r.copies,
        availableCopies: r.copies,
        shelfLocations: defaultShelf ? `${defaultShelf.code} (${defaultShelf.name})` : '',
        borrowCount: 0,
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (let k = 0; k < r.copies; k++) {
        const cNum = nextCopyNum++;
        batch.set(doc(db, 'book_copies', `copy_${cNum}`), {
          numericId: cNum,
          bookId: bookDocId,
          bookTitle: r.title,
          inventoryCode: `LP-2026-${String(cNum).padStart(4, '0')}`,
          barcode: `BC${String(20260000 + cNum)}`,
          shelfId: defaultShelf ? defaultShelf.id : '',
          shelfCode: defaultShelf ? clampString(defaultShelf.code, 64) : '',
          shelfName: defaultShelf ? clampString(defaultShelf.name, 120) : '',
          condition: 'Baik',
          status: 'Tersedia',
          acquisitionDate: todayStr,
          price: r.price,
          notes: 'Hasil import CSV/Excel',
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    try {
      await batch.commit();
      await writeAuditLog(actor, 'BOOK_IMPORT', 'books', 'batch', `Import ${toImport.length} judul buku`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'books/import');
    }
    return jsonRes({ ok: true, importedCount: toImport.length });
  }

  // 4. /api/members, /api/members/import, /api/members/[id]
  if (pathname === '/api/members' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const statusFilter = searchParams.get('status') || '';
    const [members, mTypes, loans, fines] = await Promise.all([
      listCollection('members', [where('archived', '==', false)]),
      listCollection('membership_types'),
      listCollection('loans'),
      listCollection('fines'),
    ]);

    const mTypeMap = new Map(mTypes.map((mt) => [mt.id, mt]));
    const rows = members
      .map((m) => {
        const mt = mTypeMap.get(String(m.membershipTypeId));
        const activeLoansCount = loans
          .filter((l) => l.memberId === m.id)
          .reduce(
            (s, l) =>
              s + ((l.items as Array<Record<string, unknown>>) || []).filter((i) => !i.returnedAt).length,
            0
          );
        const unpaidFinesTotal = fines
          .filter((f) => f.memberId === m.id && (f.status === 'Belum Lunas' || f.status === 'Sebagian'))
          .reduce(
            (s, f) => s + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
            0
          );
        return {
          id: Number(m.numericId),
          docId: m.id,
          member_code: String(m.memberCode || ''),
          full_name: String(m.fullName || ''),
          membership_type_id: mt ? Number(mt.numericId) : 1,
          membership_type_name: String(m.membershipTypeName || mt?.name || ''),
          identity_number: String(m.identityNumber || ''),
          gender: String(m.gender || 'Tidak Disebutkan'),
          unit_or_class: String(m.unitOrClass || ''),
          address: String(m.address || ''),
          phone: String(m.phone || ''),
          email: String(m.email || ''),
          registered_at: String(m.registeredAt || ''),
          expires_at: String(m.expiresAt || ''),
          status: String(m.status || 'Aktif'),
          block_reason: String(m.blockReason || ''),
          active_loans_count: activeLoansCount,
          max_loans: Number(mt?.maxLoans || 3),
          loan_duration_days: Number(mt?.loanDurationDays || 7),
          unpaid_fines_total: unpaidFinesTotal,
        };
      })
      .filter((m) => {
        if (statusFilter && m.status !== statusFilter) return false;
        if (!q) return true;
        return (
          m.member_code.toLowerCase().includes(q) ||
          m.full_name.toLowerCase().includes(q) ||
          m.unit_or_class.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.id - a.id);

    return jsonRes({
      members: rows,
      membershipTypes: mTypes
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((mt) => ({ id: Number(mt.numericId), docId: mt.id, name: String(mt.name) })),
    });
  }

  if (pathname === '/api/members' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const fullName = clampString(body?.fullName, 120);
    if (!fullName) return jsonRes({ error: 'Nama lengkap anggota wajib diisi.' }, 400);

    const [members, mTypes] = await Promise.all([
      listCollection('members'),
      listCollection('membership_types'),
    ]);
    const nextNum = nextNumericId(members);
    const memberDocId = `member_${nextNum}`;
    const mt =
      mTypes.find((t) => String(t.numericId) === String(body?.membershipTypeId || '1')) || mTypes[0];
    const memberCode = `AGT-2026-${String(nextNum).padStart(4, '0')}`;
    const expiresAt = addDaysIso(todayStr, 365);

    try {
      await setDoc(doc(db, 'members', memberDocId), {
        numericId: nextNum,
        memberCode,
        fullName,
        membershipTypeId: mt ? mt.id : 'mtype_1',
        membershipTypeName: mt ? clampString(mt.name, 100) : 'Siswa Kelas 1–3',
        identityNumber: clampString(body?.identityNumber, 64, ''),
        gender: clampString(body?.gender, 30, 'Tidak Disebutkan'),
        unitOrClass: clampString(body?.unitOrClass, 100, ''),
        address: clampString(body?.address, 300, ''),
        phone: clampString(body?.phone, 40, ''),
        email: clampString(body?.email, 160, ''),
        registeredAt: todayStr,
        expiresAt,
        status: 'Aktif',
        blockReason: '',
        ownerUid: '',
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'MEMBER_CREATE', 'members', memberDocId, `Registrasi anggota: ${fullName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `members/${memberDocId}`);
    }
    return jsonRes({ ok: true, id: nextNum, memberCode });
  }

  if (pathname === '/api/members/import' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const mode = String(body?.mode || 'preview');
    const rawRows = (body?.rows as Array<Record<string, unknown>>) || [];
    const evaluated = rawRows.map((r, i) => {
      const fullName = clampString(r.fullName || r.Nama || r.nama, 120);
      const unitOrClass = clampString(r.unitOrClass || r.Kelas || r.kelas || r.Unit_Kelas, 100);
      const typeName = clampString(r.membershipType || r.Jenis || r.jenis, 100);
      const identityNumber = clampString(r.identityNumber || r.NIS || r.NISN || r.NIP, 64);
      const email = clampString(r.email || r.Email, 160);
      const phone = clampString(r.phone || r.Telepon, 40);
      const address = clampString(r.address || r.Alamat, 300);
      const errors: string[] = [];
      if (!fullName) errors.push('Nama lengkap kosong');
      return {
        rowNumber: i + 1,
        fullName,
        unitOrClass,
        typeName,
        identityNumber,
        email,
        phone,
        address,
        valid: errors.length === 0,
        errors,
      };
    });

    if (mode === 'preview') {
      const validCount = evaluated.filter((r) => r.valid).length;
      return jsonRes({
        total: evaluated.length,
        validCount,
        invalidCount: evaluated.length - validCount,
        rows: evaluated,
      });
    }

    const toImport = evaluated.filter((r) => r.valid);
    const [members, mTypes] = await Promise.all([
      listCollection('members'),
      listCollection('membership_types'),
    ]);
    let nextNum = nextNumericId(members);
    const expiresAt = addDaysIso(todayStr, 365);
    const batch = writeBatch(db);

    for (const r of toImport) {
      const num = nextNum++;
      const mt =
        mTypes.find((t) => String(t.name).toLowerCase().includes(r.typeName.toLowerCase())) ||
        mTypes[0];
      batch.set(doc(db, 'members', `member_${num}`), {
        numericId: num,
        memberCode: `AGT-2026-${String(num).padStart(4, '0')}`,
        fullName: r.fullName,
        membershipTypeId: mt ? mt.id : 'mtype_1',
        membershipTypeName: mt ? clampString(mt.name, 100) : 'Siswa Kelas 1–3',
        identityNumber: r.identityNumber,
        gender: 'Tidak Disebutkan',
        unitOrClass: r.unitOrClass,
        address: r.address,
        phone: r.phone,
        email: r.email,
        registeredAt: todayStr,
        expiresAt,
        status: 'Aktif',
        blockReason: '',
        ownerUid: '',
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      await writeAuditLog(actor, 'MEMBER_IMPORT', 'members', 'batch', `Import ${toImport.length} anggota`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'members/import');
    }
    return jsonRes({ ok: true, importedCount: toImport.length });
  }

  const memberIdMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberIdMatch && memberIdMatch[1] !== 'import') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const idParam = memberIdMatch[1];
    const memberDocId = idParam.startsWith('member_') ? idParam : `member_${idParam}`;
    const member = await getDocument('members', memberDocId);
    if (!member) return jsonRes({ error: 'Anggota tidak ditemukan.' }, 404);

    if (method === 'GET') {
      const [loans, returns, fines] = await Promise.all([
        listCollection('loans', [where('memberId', '==', memberDocId)]),
        listCollection('returns', [where('memberId', '==', memberDocId)]),
        listCollection('fines', [where('memberId', '==', memberDocId)]),
      ]);
      const flatLoans: Array<Record<string, unknown>> = [];
      for (const l of loans) {
        for (const it of (l.items as Array<Record<string, unknown>>) || []) {
          flatLoans.push({
            loan_number: l.loanNumber,
            book_title: it.bookTitle,
            loan_date: l.loanDate,
            due_date: it.dueDate,
            item_status: it.status,
          });
        }
      }
      return jsonRes({
        member: {
          id: Number(member.numericId),
          member_code: member.memberCode,
          full_name: member.fullName,
          membership_type_name: member.membershipTypeName,
          status: member.status,
          expires_at: member.expiresAt,
        },
        loans: flatLoans,
        returns: returns.map((r) => ({
          return_number: r.returnNumber,
          returned_at: r.returnedAt,
          condition: r.condition,
          status: r.status,
        })),
        fines: fines.map((f) => ({
          fine_number: f.fineNumber,
          fine_type: f.fineType,
          amount: f.amount,
          status: f.status,
        })),
      });
    }

    if (method === 'PUT') {
      const action = String(body?.action || '');
      if (action === 'block' || action === 'unblock' || action === 'deactivate') {
        const newStatus = action === 'block' ? 'Diblokir' : action === 'deactivate' ? 'Nonaktif' : 'Aktif';
        const blockReason = action === 'block' ? clampString(body?.reason, 300, 'Diblokir petugas') : '';
        try {
          await updateDoc(doc(db, 'members', memberDocId), {
            status: newStatus,
            blockReason,
            updatedAt: serverTimestamp(),
          });
          await writeAuditLog(actor, `MEMBER_${action.toUpperCase()}`, 'members', memberDocId, `${member.fullName} -> ${newStatus}`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `members/${memberDocId}`);
        }
        return jsonRes({ ok: true, status: newStatus });
      }

      if (action === 'extend') {
        const days = Math.max(30, Number(body?.days || 365));
        const base = String(member.expiresAt || todayStr) > todayStr ? String(member.expiresAt) : todayStr;
        const newExpiry = addDaysIso(base, days);
        const nextStatus = member.status === 'Diblokir' ? 'Diblokir' : 'Aktif';
        try {
          await updateDoc(doc(db, 'members', memberDocId), {
            expiresAt: newExpiry,
            status: nextStatus,
            updatedAt: serverTimestamp(),
          });
          await writeAuditLog(actor, 'MEMBER_EXTEND', 'members', memberDocId, `Perpanjang hingga ${newExpiry}`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `members/${memberDocId}`);
        }
        return jsonRes({ ok: true, expiresAt: newExpiry, status: nextStatus });
      }

      if (action === 'archive') {
        const memberLoans = await listCollection('loans', [where('memberId', '==', memberDocId)]);
        const hasActive = memberLoans.some((l) =>
          ((l.items as Array<Record<string, unknown>>) || []).some((it) => !it.returnedAt)
        );
        if (hasActive) {
          return jsonRes(
            { error: 'Anggota tidak dapat diarsipkan karena masih memiliki pinjaman aktif.' },
            409
          );
        }
        try {
          await updateDoc(doc(db, 'members', memberDocId), {
            status: 'Nonaktif',
            archived: true,
            updatedAt: serverTimestamp(),
          });
          await writeAuditLog(actor, 'MEMBER_ARCHIVE', 'members', memberDocId, `Arsip anggota: ${member.fullName}`);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `members/${memberDocId}`);
        }
        return jsonRes({ ok: true });
      }

      const fullName = clampString(body?.fullName, 120);
      if (!fullName) return jsonRes({ error: 'Nama lengkap wajib diisi.' }, 400);
      const mTypes = await listCollection('membership_types');
      const mt = mTypes.find(
        (t) => String(t.numericId) === String(body?.membershipTypeId || '1')
      );
      try {
        await updateDoc(doc(db, 'members', memberDocId), {
          fullName,
          membershipTypeId: mt ? mt.id : String(member.membershipTypeId),
          membershipTypeName: mt ? clampString(mt.name, 100) : String(member.membershipTypeName),
          identityNumber: clampString(body?.identityNumber, 64, ''),
          gender: clampString(body?.gender, 30, 'Tidak Disebutkan'),
          unitOrClass: clampString(body?.unitOrClass, 100, ''),
          address: clampString(body?.address, 300, ''),
          phone: clampString(body?.phone, 40, ''),
          email: clampString(body?.email, 160, ''),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(actor, 'MEMBER_UPDATE', 'members', memberDocId, `Edit anggota: ${fullName}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `members/${memberDocId}`);
      }
      return jsonRes({ ok: true });
    }
  }

  // 5. /api/loans & /api/loans/[id]/renew
  if (pathname === '/api/loans' && method === 'GET') {
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const statusFilter = searchParams.get('status') || '';
    const [loans, globalSet] = await Promise.all([
      isStaff
        ? listCollection('loans')
        : listCollection('loans', [where('ownerUid', '==', actor.uid)]),
      getDocument('library_settings', 'global'),
    ]);
    const policy = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    );

    const rows = loans
      .map((l) => ({
        id: Number(l.numericId),
        docId: l.id,
        loan_number: String(l.loanNumber || ''),
        member_code: String(l.memberCode || ''),
        member_name: String(l.memberName || ''),
        loan_date: String(l.loanDate || ''),
        due_date: String(l.dueDate || ''),
        status: String(l.status || 'Aktif'),
        max_renewals: Number(l.maxRenewals ?? 1),
        items: ((l.items as Array<Record<string, unknown>>) || []).map((it) => ({
          id: Number(it.id || 1),
          copy_id: Number(String(it.copyId || '').replace('copy_', '')) || 0,
          inventory_code: String(it.inventoryCode || ''),
          book_title: String(it.bookTitle || ''),
          due_date: String(it.dueDate || l.dueDate),
          returned_at: (it.returnedAt as string | null) ?? null,
          status: String(it.status || 'Dipinjam'),
          renewal_count: Number(it.renewalCount || 0),
        })),
      }))
      .filter((l) => {
        if (statusFilter && l.status !== statusFilter) return false;
        if (!q) return true;
        return (
          l.loan_number.toLowerCase().includes(q) ||
          l.member_name.toLowerCase().includes(q) ||
          l.member_code.toLowerCase().includes(q) ||
          l.items.some((i) => i.book_title.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.id - a.id);

    return jsonRes({
      loans: rows,
      policy: {
        blockOnUnpaidFinesLimit: policy.blockOnUnpaidFinesLimit,
        allowOverdueRenewal: policy.allowOverdueRenewal,
      },
    });
  }

  if (pathname === '/api/loans' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const memberIdParam = String(body?.memberId || '');
    const memberDocId = memberIdParam.startsWith('member_') ? memberIdParam : `member_${memberIdParam}`;
    const copyIdsRaw = (body?.copyIds as Array<string | number>) || [];
    const copyDocIds = copyIdsRaw.map((c) => (String(c).startsWith('copy_') ? String(c) : `copy_${c}`));
    const idempotencyKey = clampString(body?.idempotencyKey, 128, `loan_${Date.now()}`);
    if (!memberDocId || copyDocIds.length === 0) {
      return jsonRes({ error: 'Anggota dan eksemplar buku wajib dipilih.' }, 400);
    }

    const [allLoans, allFines, globalSet, memberReservations] = await Promise.all([
      listCollection('loans'),
      listCollection('fines', [where('memberId', '==', memberDocId)]),
      getDocument('library_settings', 'global'),
      listCollection('reservations', [where('memberId', '==', memberDocId)]),
    ]);

    const existingIdem = allLoans.find((l) => l.idempotencyKey === idempotencyKey);
    if (existingIdem) {
      return jsonRes({
        ok: true,
        loanNumber: existingIdem.loanNumber,
        dueDate: existingIdem.dueDate,
        duplicate: true,
      });
    }

    const activeLoansCount = allLoans
      .filter((l) => l.memberId === memberDocId)
      .reduce(
        (s, l) => s + ((l.items as Array<Record<string, unknown>>) || []).filter((i) => !i.returnedAt).length,
        0
      );
    const unpaidFinesTotal = allFines
      .filter((f) => f.status === 'Belum Lunas' || f.status === 'Sebagian')
      .reduce(
        (s, f) => s + Math.max(0, Number(f.amount || 0) - Number(f.paidAmount || 0) - Number(f.waivedAmount || 0)),
        0
      );
    const loanPolicy = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    );
    const blockLimit = loanPolicy.blockOnUnpaidFinesLimit;

    const nextNum = nextNumericId(allLoans);
    const loanDocId = `loan_${nextNum}`;
    const loanNumber = `PJM-2026-${String(nextNum).padStart(4, '0')}`;
    let finalDueDate = '';
    const affectedBookIds = new Set<string>();

    try {
      await runTransaction(db, async (tx) => {
        const memSnap = await tx.get(doc(db, 'members', memberDocId));
        if (!memSnap.exists()) throw new Error('Anggota tidak ditemukan.');
        const mem = memSnap.data();

        const mtSnap = await tx.get(doc(db, 'membership_types', String(mem.membershipTypeId)));
        const mt = mtSnap.exists() ? mtSnap.data() : { maxLoans: 3, loanDurationDays: 7, maxRenewals: 1 };

        const copySnaps = await Promise.all(copyDocIds.map((cid) => tx.get(doc(db, 'book_copies', cid))));
        const bookIds = Array.from(
          new Set(copySnaps.map((s) => String(s.data()?.bookId || '')).filter(Boolean))
        );
        const bookSnaps = await Promise.all(bookIds.map((bid) => tx.get(doc(db, 'books', bid))));
        const bookMap = new Map(bookSnaps.filter((s) => s.exists()).map((s) => [s.id, s.data()!]));

        const dueDate = calculateDueDate(todayStr, Number(mt.loanDurationDays || 7));
        finalDueDate = dueDate;
        const loanItems: Array<Record<string, unknown>> = [];
        const fulfilledResIds: string[] = [];

        for (let idx = 0; idx < copySnaps.length; idx++) {
          const cSnap = copySnaps[idx];
          if (!cSnap.exists()) throw new Error('Salah satu eksemplar tidak ditemukan.');
          const cData = cSnap.data();
          const bData = bookMap.get(String(cData.bookId));
          const matchingRes =
            cData.status === 'Direservasi'
              ? memberReservations.find(
                  (r) => r.copyId === cSnap.id && r.status === 'Tersedia'
                )
              : undefined;
          const elig = validateLoanEligibility({
            memberStatus: mem.status as MemberStatus,
            memberExpiresAt: String(mem.expiresAt || todayStr),
            activeLoansCount,
            maxLoans: Number(mt.maxLoans || 3),
            requestedCount: copySnaps.length,
            copyStatus: cData.status as CopyStatus,
            isReferenceOnly: Boolean(bData?.isReferenceOnly),
            readInPlaceOnly: Boolean(bData?.readInPlaceOnly),
            todayStr,
            unpaidFinesTotal,
            blockOnUnpaidFinesLimit: blockLimit,
            reservedForMember: Boolean(matchingRes),
          });
          if (!elig.ok) throw new Error(elig.reason || 'Tidak memenuhi syarat peminjaman.');
          if (matchingRes) fulfilledResIds.push(matchingRes.id);
          affectedBookIds.add(String(cData.bookId));
          loanItems.push({
            id: idx + 1,
            copyId: cSnap.id,
            inventoryCode: String(cData.inventoryCode),
            bookTitle: String(cData.bookTitle),
            dueDate,
            returnedAt: null,
            status: 'Dipinjam',
            renewalCount: 0,
            returnCondition: null,
          });
        }

        tx.set(doc(db, 'loans', loanDocId), {
          numericId: nextNum,
          loanNumber,
          idempotencyKey,
          memberId: memberDocId,
          memberCode: clampString(mem.memberCode, 64),
          memberName: clampString(mem.fullName, 120),
          ownerUid: clampString(mem.ownerUid, 128, ''),
          staffUid: actor.uid,
          staffName: clampString(actor.fullName, 120),
          loanDate: todayStr,
          dueDate,
          maxRenewals: Number(mt.maxRenewals || 1),
          status: 'Aktif',
          notes: clampString(body?.notes, 500, ''),
          items: loanItems,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        for (const cSnap of copySnaps) {
          tx.update(doc(db, 'book_copies', cSnap.id), {
            status: 'Dipinjam',
            updatedAt: serverTimestamp(),
          });
        }

        for (const resId of fulfilledResIds) {
          tx.update(doc(db, 'reservations', resId), {
            status: 'Diambil',
            updatedAt: serverTimestamp(),
          });
        }

        for (const bid of affectedBookIds) {
          const bData = bookMap.get(bid);
          if (bData) {
            tx.update(doc(db, 'books', bid), {
              borrowCount: Number(bData.borrowCount || 0) + 1,
              updatedAt: serverTimestamp(),
            });
          }
        }
      });

      for (const bid of affectedBookIds) {
        await syncPublicCatalogForBook(bid);
      }
      await writeAuditLog(actor, 'LOAN_CREATE', 'loans', loanDocId, `Peminjaman ${loanNumber}`);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith('{')) {
        return jsonRes({ error: err.message }, 400);
      }
      handleFirestoreError(err, OperationType.WRITE, `loans/${loanDocId}`);
    }

    return jsonRes({ ok: true, loanNumber, dueDate: finalDueDate });
  }

  const renewMatch = pathname.match(/^\/api\/loans\/([^/]+)\/renew$/);
  if (renewMatch && method === 'POST') {
    const idParam = renewMatch[1];
    const loanDocId = idParam.startsWith('loan_') ? idParam : `loan_${idParam}`;
    const itemId = Number(body?.loanItemId || 1);
    const [globalSet, reservations] = await Promise.all([
      getDocument('library_settings', 'global'),
      listCollection('reservations'),
    ]);
    const allowOverdue = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    ).allowOverdueRenewal;

    let newDueDate = '';
    try {
      await runTransaction(db, async (tx) => {
        const loanSnap = await tx.get(doc(db, 'loans', loanDocId));
        if (!loanSnap.exists()) throw new Error('Transaksi peminjaman tidak ditemukan.');
        const loan = loanSnap.data();
        if (!isStaff && String(loan.ownerUid || '') !== actor.uid) {
          throw new Error('Anda hanya dapat memperpanjang peminjaman milik sendiri.');
        }
        const memSnap = await tx.get(doc(db, 'members', String(loan.memberId)));
        if (!memSnap.exists()) throw new Error('Anggota tidak ditemukan.');
        const mem = memSnap.data();
        const mtSnap = await tx.get(doc(db, 'membership_types', String(mem.membershipTypeId)));
        const mt = mtSnap.exists() ? mtSnap.data() : { loanDurationDays: 7, maxRenewals: 1 };

        const items = [...((loan.items as Array<Record<string, unknown>>) || [])];
        const idx = items.findIndex((i) => Number(i.id) === itemId);
        if (idx === -1) throw new Error('Item buku tidak ditemukan.');
        const item = items[idx];
        if (item.returnedAt) throw new Error('Buku ini sudah dikembalikan.');
        const copySnap = await tx.get(doc(db, 'book_copies', String(item.copyId)));
        const bookId = copySnap.data()?.bookId;
        const hasQueue = reservations.some(
          (r) => r.bookId === bookId && (r.status === 'Menunggu' || r.status === 'Tersedia')
        );

        const elig = validateRenewalEligibility({
          memberStatus: mem.status as MemberStatus,
          memberExpiresAt: String(mem.expiresAt || todayStr),
          todayStr,
          currentRenewals: Number(item.renewalCount || 0),
          maxRenewals: Number(mt.maxRenewals || loan.maxRenewals || 1),
          dueDateStr: String(item.dueDate || loan.dueDate),
          hasActiveReservationQueue: hasQueue,
          allowOverdueRenewal: allowOverdue,
        });
        if (!elig.ok) throw new Error(elig.reason || 'Perpanjangan ditolak.');

        const currentDue = String(item.dueDate || loan.dueDate || todayStr);
        const baseDate = currentDue > todayStr ? currentDue : todayStr;
        newDueDate = calculateDueDate(baseDate, Number(mt.loanDurationDays || 7));
        items[idx] = {
          ...item,
          dueDate: newDueDate,
          status: 'Dipinjam',
          renewalCount: Number(item.renewalCount || 0) + 1,
        };

        const unreturned = items.filter((i) => !i.returnedAt);
        const hasOverdue = unreturned.some((i) => String(i.dueDate || '') < todayStr);
        const hasReturned = items.some((i) => Boolean(i.returnedAt));
        const maxDueDate = unreturned
          .map((i) => String(i.dueDate || newDueDate))
          .sort()
          .pop() || newDueDate;
        const nextLoanStatus = hasOverdue
          ? 'Terlambat'
          : hasReturned
            ? 'Sebagian Kembali'
            : 'Aktif';

        tx.update(doc(db, 'loans', loanDocId), {
          items,
          dueDate: maxDueDate,
          status: nextLoanStatus,
          updatedAt: serverTimestamp(),
        });
      });
      await writeAuditLog(actor, 'LOAN_RENEW', 'loans', loanDocId, `Perpanjang jatuh tempo -> ${newDueDate}`);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith('{')) {
        return jsonRes({ error: err.message }, 400);
      }
      handleFirestoreError(err, OperationType.UPDATE, `loans/${loanDocId}`);
    }
    return jsonRes({ ok: true, newDueDate });
  }

  // 6. /api/returns
  if (pathname === '/api/returns' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const [loans, returns, members, mTypes, copies, books, globalSet] = await Promise.all([
      listCollection('loans'),
      listCollection('returns'),
      listCollection('members'),
      listCollection('membership_types'),
      listCollection('book_copies'),
      listCollection('books'),
      getDocument('library_settings', 'global'),
    ]);
    const policyVals = (globalSet?.values as Record<string, string>) || {};

    const memMap = new Map(members.map((m) => [m.id, m]));
    const mtMap = new Map(mTypes.map((mt) => [mt.id, mt]));
    const copyMap = new Map(copies.map((c) => [c.id, c]));
    const bookMap = new Map(books.map((b) => [b.id, b]));

    const activeItems: Array<Record<string, unknown>> = [];
    for (const l of loans) {
      const mem = memMap.get(String(l.memberId));
      const mt = mem ? mtMap.get(String(mem.membershipTypeId)) : null;
      for (const it of (l.items as Array<Record<string, unknown>>) || []) {
        if (it.returnedAt) continue;
        const cp = copyMap.get(String(it.copyId));
        const bk = cp ? bookMap.get(String(cp.bookId)) : null;
        activeItems.push({
          loan_item_id: Number(l.numericId) * 1000 + Number(it.id || 1),
          _loanDocId: l.id,
          _itemId: Number(it.id || 1),
          loan_id: Number(l.numericId),
          copy_id: Number(cp?.numericId || 0),
          due_date: String(it.dueDate || l.dueDate),
          item_status: String(it.dueDate || l.dueDate) < todayStr ? 'Terlambat' : String(it.status),
          loan_number: String(l.loanNumber),
          loan_date: String(l.loanDate),
          member_code: String(l.memberCode),
          member_name: String(l.memberName),
          daily_fine_rate: Number(mt?.dailyFineRate || 500),
          max_fine_cap: Number(mt?.maxFineCap || 15000),
          book_title: String(it.bookTitle),
          book_price: Number(bk?.price || 60000),
          inventory_code: String(it.inventoryCode),
          barcode: String(cp?.barcode || ''),
          copy_price: Number(cp?.price || bk?.price || 60000),
        });
      }
    }

    const retRows = returns
      .map((r) => ({
        id: Number(r.numericId),
        return_number: String(r.returnNumber),
        loan_number: String(r.loanNumber),
        member_name: String(r.memberName),
        book_title: String(r.bookTitle),
        inventory_code: String(r.inventoryCode),
        returned_at: String(r.returnedAt),
        condition: String(r.condition),
        status: String(r.status),
        overdue_days: Number(r.overdueDays || 0),
        fine_amount: Number(r.fineAmount || 0),
      }))
      .sort((a, b) => b.id - a.id);

    const retPolicy = extractCirculationPolicy(policyVals);
    return jsonRes({
      activeItems,
      returns: retRows,
      policy: {
        gracePeriodDays: retPolicy.gracePeriodDays,
        damageFeePercent: retPolicy.damageFeePercent,
        lostFeePercent: retPolicy.lostFeePercent,
        reservationExpiryDays: retPolicy.reservationExpiryDays,
      },
    });
  }

  if (pathname === '/api/returns' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const encodedItemId = Number(body?.loanItemId || 0);
    const loanNum = Math.floor(encodedItemId / 1000);
    const itemId = encodedItemId % 1000 || 1;
    const loanDocId = `loan_${loanNum}`;
    const validConditions: CopyCondition[] = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'];
    const rawCond = clampString(body?.condition, 40, 'Baik') as CopyCondition;
    if (!validConditions.includes(rawCond)) {
      return jsonRes({ error: 'Kondisi buku pengembalian tidak valid.' }, 400);
    }
    const condition: CopyCondition = rawCond;

    const [returns, fines, reservations, globalSet] = await Promise.all([
      listCollection('returns'),
      listCollection('fines'),
      listCollection('reservations'),
      getDocument('library_settings', 'global'),
    ]);
    const retPolicy = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    );
    const graceDays = retPolicy.gracePeriodDays;
    const damagePercent = retPolicy.damageFeePercent;
    const lostFeePercent = retPolicy.lostFeePercent;
    const reservationExpiryDays = retPolicy.reservationExpiryDays;

    const nextRetNum = nextNumericId(returns);
    const retDocId = `ret_${nextRetNum}`;
    const returnNumber = `KMB-2026-${String(nextRetNum).padStart(4, '0')}`;
    const nextFineNum = nextNumericId(fines);
    const fineDocId = `fine_${nextFineNum}`;
    const fineNumber = `DND-2026-${String(nextFineNum).padStart(4, '0')}`;

    let totalFine = 0;
    let returnStatus = 'Tepat Waktu';
    let newCopyStatus: CopyStatus = 'Tersedia';
    let affectedBookId = '';

    try {
      await runTransaction(db, async (tx) => {
        const loanSnap = await tx.get(doc(db, 'loans', loanDocId));
        if (!loanSnap.exists()) throw new Error('Data peminjaman tidak ditemukan.');
        const loan = loanSnap.data();
        const items = [...((loan.items as Array<Record<string, unknown>>) || [])];
        const idx = items.findIndex((i) => Number(i.id) === itemId);
        if (idx === -1) throw new Error('Item buku pada pinjaman tidak ditemukan.');
        const item = items[idx];
        if (item.returnedAt) throw new Error('Buku ini sudah dikembalikan sebelumnya.');

        const memSnap = await tx.get(doc(db, 'members', String(loan.memberId)));
        const mem = memSnap.data() || {};
        const mtSnap = await tx.get(doc(db, 'membership_types', String(mem.membershipTypeId || 'mtype_1')));
        const mt = mtSnap.data() || {};
        const copySnap = await tx.get(doc(db, 'book_copies', String(item.copyId)));
        const copyData = copySnap.data() || {};
        affectedBookId = String(copyData.bookId || '');

        const overdueDays = calculateOverdueDays(String(item.dueDate || loan.dueDate), todayStr, graceDays);
        const fineCalc = calculateFineAmount({
          overdueDays,
          dailyRate: Number(mt.dailyFineRate || 500),
          maxCap: Number(mt.maxFineCap || 15000),
          condition,
          bookPrice: Number(copyData.price || 60000),
          damageFeePercent: damagePercent,
          lostFeePercent,
        });
        totalFine = fineCalc.totalFine;

        if (condition === 'Hilang') {
          returnStatus = 'Hilang';
          newCopyStatus = 'Hilang';
        } else if (condition === 'Rusak Berat') {
          returnStatus = 'Rusak';
          newCopyStatus = 'Perbaikan';
        } else {
          returnStatus = overdueDays > 0 ? 'Terlambat' : 'Tepat Waktu';
          // Check waiting reservation
          const waitingRes = reservations
            .filter((r) => r.bookId === affectedBookId && r.status === 'Menunggu')
            .sort((a, b) => Number(a.queuePosition) - Number(b.queuePosition))[0];
          if (waitingRes) {
            newCopyStatus = 'Direservasi';
            tx.update(doc(db, 'reservations', waitingRes.id), {
              copyId: copySnap.id,
              inventoryCode: String(copyData.inventoryCode || ''),
              status: 'Tersedia',
              expiresAt: addDaysIso(todayStr, reservationExpiryDays),
              updatedAt: serverTimestamp(),
            });
          } else {
            newCopyStatus = 'Tersedia';
          }
        }

        items[idx] = {
          ...item,
          returnedAt: todayStr,
          status: 'Dikembalikan',
          returnCondition: condition,
        };
        const allDone = items.every((i) => Boolean(i.returnedAt));
        tx.update(doc(db, 'loans', loanDocId), {
          items,
          status: allDone ? 'Selesai' : 'Sebagian Kembali',
          updatedAt: serverTimestamp(),
        });

        tx.update(doc(db, 'book_copies', copySnap.id), {
          status: newCopyStatus,
          condition,
          updatedAt: serverTimestamp(),
        });

        tx.set(doc(db, 'returns', retDocId), {
          numericId: nextRetNum,
          returnNumber,
          loanId: loanDocId,
          loanNumber: String(loan.loanNumber),
          copyId: copySnap.id,
          inventoryCode: String(copyData.inventoryCode || ''),
          bookTitle: String(item.bookTitle || ''),
          memberId: String(loan.memberId),
          memberName: String(loan.memberName),
          ownerUid: String(loan.ownerUid || ''),
          staffUid: actor.uid,
          returnedAt: todayStr,
          condition,
          status: returnStatus,
          overdueDays,
          fineAmount: totalFine,
          notes: clampString(body?.notes, 500, ''),
          createdAt: serverTimestamp(),
        });

        if (totalFine > 0) {
          const fType =
            condition === 'Hilang'
              ? 'Kehilangan'
              : condition === 'Rusak Berat' || condition === 'Rusak Ringan'
                ? 'Kerusakan'
                : 'Keterlambatan';
          tx.set(doc(db, 'fines', fineDocId), {
            numericId: nextFineNum,
            fineNumber,
            memberId: String(loan.memberId),
            memberCode: String(loan.memberCode),
            memberName: String(loan.memberName),
            ownerUid: String(loan.ownerUid || ''),
            loanId: loanDocId,
            loanNumber: String(loan.loanNumber),
            returnId: retDocId,
            fineType: fType,
            amount: totalFine,
            paidAmount: 0,
            waivedAmount: 0,
            status: 'Belum Lunas',
            reason: `${fType} (${returnNumber})`,
            createdByUid: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });

      if (affectedBookId) await syncPublicCatalogForBook(affectedBookId);
      await writeAuditLog(actor, 'RETURN_CREATE', 'returns', retDocId, `Pengembalian ${returnNumber}`);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith('{')) {
        return jsonRes({ error: err.message }, 400);
      }
      handleFirestoreError(err, OperationType.WRITE, `returns/${retDocId}`);
    }

    return jsonRes({ ok: true, returnNumber, returnStatus, newCopyStatus, totalFine });
  }

  // 7. /api/reservations
  if (pathname === '/api/reservations' && method === 'GET') {
    const reservations = isStaff
      ? await listCollection('reservations')
      : await listCollection('reservations', [where('ownerUid', '==', actor.uid)]);
    const rows = reservations
      .map((r) => ({
        id: Number(r.numericId),
        docId: r.id,
        reservation_number: String(r.reservationNumber),
        book_id: Number(String(r.bookId || '').replace('book_', '')) || 0,
        book_title: String(r.bookTitle),
        isbn: String(r.isbn || ''),
        member_code: String(r.memberCode),
        member_name: String(r.memberName),
        inventory_code: r.inventoryCode ? String(r.inventoryCode) : null,
        queue_position: Number(r.queuePosition || 1),
        status: String(r.status),
        reserved_at: String(r.reservedAt),
        expires_at: r.expiresAt ? String(r.expiresAt) : null,
        notes: String(r.notes || ''),
      }))
      .sort((a, b) => b.id - a.id);
    return jsonRes({ reservations: rows });
  }

  if (pathname === '/api/reservations' && method === 'POST') {
    const bookIdParam = String(body?.bookId || '');
    const bookDocId = bookIdParam.startsWith('book_') ? bookIdParam : `book_${bookIdParam}`;
    const memberIdParam =
      actor.roleSlug === 'anggota' && actor.memberDocId
        ? actor.memberDocId
        : String(body?.memberId || '1');
    const memberDocId = memberIdParam.startsWith('member_') ? memberIdParam : `member_${memberIdParam}`;

    const [pubBook, mem, existingRes] = await Promise.all([
      getDocument('public_catalog', bookDocId),
      getDocument('members', memberDocId),
      isStaff
        ? listCollection('reservations')
        : listCollection('reservations', [where('ownerUid', '==', actor.uid)]),
    ]);

    if (!pubBook) return jsonRes({ error: 'Buku tidak ditemukan.' }, 404);
    if (!mem) return jsonRes({ error: 'Data keanggotaan tidak ditemukan.' }, 404);
    if (pubBook.isReferenceOnly || pubBook.readInPlaceOnly) {
      return jsonRes({ error: 'Buku referensi tidak dapat direservasi.' }, 400);
    }

    const activeQueue = existingRes.filter(
      (r) => r.bookId === bookDocId && (r.status === 'Menunggu' || r.status === 'Tersedia')
    );
    if (activeQueue.some((r) => r.memberId === memberDocId)) {
      return jsonRes({ error: 'Anggota sudah masuk antrean reservasi buku ini.' }, 409);
    }

    const nextNum = nextNumericId(existingRes) + Math.floor(Math.random() * 5);
    const resDocId = `res_${Date.now()}_${nextNum}`;
    const reservationNumber = `RSV-2026-${String(nextNum).padStart(4, '0')}`;
    const queuePosition = activeQueue.length + 1;

    try {
      await setDoc(doc(db, 'reservations', resDocId), {
        numericId: nextNum,
        reservationNumber,
        bookId: bookDocId,
        bookTitle: clampString(pubBook.title, 240),
        isbn: clampString(pubBook.isbn, 40, ''),
        copyId: '',
        inventoryCode: '',
        memberId: memberDocId,
        memberCode: clampString(mem.memberCode, 64),
        memberName: clampString(mem.fullName, 120),
        ownerUid: clampString(mem.ownerUid || (actor.roleSlug === 'anggota' ? actor.uid : ''), 128, ''),
        queuePosition,
        status: 'Menunggu',
        reservedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        expiresAt: '',
        notes: clampString(body?.notes, 400, ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (isStaff) {
        await writeAuditLog(actor, 'RESERVATION_CREATE', 'reservations', resDocId, reservationNumber);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reservations/${resDocId}`);
    }
    return jsonRes({ ok: true, reservationNumber, queuePosition });
  }

  if (pathname === '/api/reservations' && method === 'PATCH') {
    const resNum = Number(body?.reservationId || 0);
    const action = String(body?.action || '');
    if (action !== 'cancel' && action !== 'pickup') {
      return jsonRes({ error: 'Aksi reservasi tidak valid.' }, 400);
    }
    if (action === 'pickup' && !isStaff) {
      return jsonRes(
        { error: 'Hanya petugas sirkulasi yang dapat menandai pengambilan reservasi.' },
        403
      );
    }
    const reservations = isStaff
      ? await listCollection('reservations')
      : await listCollection('reservations', [where('ownerUid', '==', actor.uid)]);
    const target = reservations.find((r) => Number(r.numericId) === resNum);
    if (!target) return jsonRes({ error: 'Reservasi tidak ditemukan.' }, 404);

    const curStatus = String(target.status || '');
    if (action === 'pickup' && curStatus !== 'Tersedia') {
      return jsonRes(
        { error: 'Hanya reservasi berstatus Tersedia yang dapat ditandai sudah diambil.' },
        400
      );
    }
    if (action === 'cancel' && curStatus !== 'Menunggu' && curStatus !== 'Tersedia') {
      return jsonRes(
        { error: 'Reservasi dengan status saat ini tidak dapat dibatalkan.' },
        400
      );
    }

    const nextStatus = action === 'cancel' ? 'Dibatalkan' : 'Diambil';
    try {
      await updateDoc(doc(db, 'reservations', target.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      if (target.copyId) {
        if (action === 'cancel') {
          const allRes = isStaff ? reservations : await listCollection('reservations');
          const nextWaiting = allRes
            .filter(
              (r) =>
                r.id !== target.id &&
                r.bookId === target.bookId &&
                r.status === 'Menunggu'
            )
            .sort((a, b) => Number(a.queuePosition || 0) - Number(b.queuePosition || 0))[0];

          if (nextWaiting) {
            const globalSet = await getDocument('library_settings', 'global');
            const resPolicy = extractCirculationPolicy(
              (globalSet?.values as Record<string, string>) || {}
            );
            await updateDoc(doc(db, 'reservations', nextWaiting.id), {
              copyId: String(target.copyId),
              inventoryCode: String(target.inventoryCode || ''),
              status: 'Tersedia',
              expiresAt: addDaysIso(todayStr, resPolicy.reservationExpiryDays),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(doc(db, 'book_copies', String(target.copyId)), {
              status: 'Tersedia',
              updatedAt: serverTimestamp(),
            });
            await syncPublicCatalogForBook(String(target.bookId));
          }
        } else if (action === 'pickup') {
          await updateDoc(doc(db, 'book_copies', String(target.copyId)), {
            status: 'Tersedia',
            updatedAt: serverTimestamp(),
          });
          await syncPublicCatalogForBook(String(target.bookId));
        }
      }
      if (isStaff) {
        await writeAuditLog(
          actor,
          `RESERVATION_${action.toUpperCase()}`,
          'reservations',
          target.id,
          `${target.reservationNumber} -> ${nextStatus}`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reservations/${target.id}`);
    }
    return jsonRes({ ok: true });
  }

  // 8. /api/fines
  if (pathname === '/api/fines' && method === 'GET') {
    const [fines, payments, globalSet] = await Promise.all([
      isStaff
        ? listCollection('fines')
        : listCollection('fines', [where('ownerUid', '==', actor.uid)]),
      isStaff
        ? listCollection('payments')
        : listCollection('payments', [where('ownerUid', '==', actor.uid)]),
      getDocument('library_settings', 'global'),
    ]);
    const finePolicy = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    );

    return jsonRes({
      fines: fines
        .map((f) => ({
          id: Number(f.numericId),
          fine_number: String(f.fineNumber),
          member_code: String(f.memberCode),
          member_name: String(f.memberName),
          loan_number: f.loanNumber ? String(f.loanNumber) : null,
          fine_type: String(f.fineType),
          amount: Number(f.amount || 0),
          paid_amount: Number(f.paidAmount || 0),
          waived_amount: Number(f.waivedAmount || 0),
          status: String(f.status),
          reason: String(f.reason || ''),
          created_at: tsToIso(f.createdAt),
        }))
        .sort((a, b) => b.id - a.id),
      payments: payments
        .map((p) => ({
          id: Number(p.numericId),
          payment_number: String(p.paymentNumber),
          fine_number: String(p.fineNumber),
          member_code: String(p.memberCode),
          member_name: String(p.memberName),
          amount: Number(p.amount || 0),
          method: String(p.method),
          received_by_name: String(p.receivedByName || ''),
          paid_at: String(p.paidAt || ''),
          notes: String(p.notes || ''),
        }))
        .sort((a, b) => b.id - a.id),
      policy: {
        allowPartialFinePayment: finePolicy.allowPartialFinePayment,
      },
    });
  }

  if (pathname === '/api/fines' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const fineDocId = `fine_${Number(body?.fineId || 0)}`;
    const action = String(body?.action || 'pay');
    const globalSet = await getDocument('library_settings', 'global');
    const allowPartial = extractCirculationPolicy(
      (globalSet?.values as Record<string, string>) || {}
    ).allowPartialFinePayment;

    if (action === 'waive') {
      if (!actor.permissions.includes('*') && !actor.permissions.includes('fines.waive')) {
        return jsonRes({ error: 'Hanya Kepala Perpustakaan / Super Admin yang dapat membebaskan denda.' }, 403);
      }
      const fine = await getDocument('fines', fineDocId);
      if (!fine) return jsonRes({ error: 'Tagihan tidak ditemukan.' }, 404);
      const remaining = Math.max(
        0,
        Number(fine.amount || 0) - Number(fine.paidAmount || 0) - Number(fine.waivedAmount || 0)
      );
      try {
        await updateDoc(doc(db, 'fines', fineDocId), {
          waivedAmount: Number(fine.waivedAmount || 0) + remaining,
          status: 'Dibebaskan',
          reason: clampString(body?.reason, 400, String(fine.reason || 'Pengecualian resmi')),
          updatedAt: serverTimestamp(),
        });
        await writeAuditLog(actor, 'FINE_WAIVE', 'fines', fineDocId, `Bebaskan denda ${fine.fineNumber}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `fines/${fineDocId}`);
      }
      return jsonRes({ ok: true });
    }

    const payments = await listCollection('payments');
    const nextPayNum = nextNumericId(payments);
    const payDocId = `pay_${nextPayNum}`;
    const paymentNumber = `BYR-2026-${String(nextPayNum).padStart(4, '0')}`;
    let newStatus = 'Lunas';

    try {
      await runTransaction(db, async (tx) => {
        const fineSnap = await tx.get(doc(db, 'fines', fineDocId));
        if (!fineSnap.exists()) throw new Error('Tagihan denda tidak ditemukan.');
        const fine = fineSnap.data();

        const val = validatePaymentAmount({
          fineAmount: Number(fine.amount || 0),
          paidAmount: Number(fine.paidAmount || 0),
          waivedAmount: Number(fine.waivedAmount || 0),
          paymentAmount: Number(body?.amount || 0),
          allowPartialPayment: allowPartial,
        });
        if (!val.ok) throw new Error(val.reason || 'Nominal pembayaran tidak valid.');
        newStatus = val.newStatus || 'Lunas';

        tx.update(doc(db, 'fines', fineDocId), {
          paidAmount: val.newPaidAmount,
          status: newStatus,
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'payments', payDocId), {
          numericId: nextPayNum,
          paymentNumber,
          fineId: fineDocId,
          fineNumber: String(fine.fineNumber),
          memberId: String(fine.memberId),
          memberCode: String(fine.memberCode),
          memberName: String(fine.memberName),
          ownerUid: String(fine.ownerUid || ''),
          amount: Number(body?.amount),
          method: clampString(body?.method, 40, 'Tunai'),
          receivedByUid: actor.uid,
          receivedByName: clampString(actor.fullName, 120),
          paidAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          notes: clampString(body?.notes, 400, ''),
          createdAt: serverTimestamp(),
        });
      });
      await writeAuditLog(actor, 'FINE_PAYMENT', 'payments', payDocId, `Pembayaran ${paymentNumber}`);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith('{')) {
        return jsonRes({ error: err.message }, 400);
      }
      handleFirestoreError(err, OperationType.WRITE, `payments/${payDocId}`);
    }
    return jsonRes({ ok: true, paymentNumber, newStatus });
  }

  // 9. /api/inventory
  if (pathname === '/api/inventory' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const activeAuditId = searchParams.get('auditId');
    const [locations, shelves, copies, books, audits] = await Promise.all([
      listCollection('locations'),
      listCollection('shelves'),
      listCollection('book_copies', [where('archived', '==', false)]),
      listCollection('books'),
      listCollection('inventory_audits'),
    ]);
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const shelfRows = shelves
      .sort((a, b) => Number(a.numericId) - Number(b.numericId))
      .map((s) => ({
        id: Number(s.numericId),
        location_id: Number(String(s.locationId || '').replace('loc_', '')) || 1,
        code: String(s.code),
        name: String(s.name),
        capacity: Number(s.capacity || 150),
        building: String(s.building || ''),
        room: String(s.room || ''),
        current_count: copies.filter((c) => c.shelfId === s.id && c.status !== 'Dihapus').length,
      }));

    const copyRows = copies
      .sort((a, b) => Number(b.numericId) - Number(a.numericId))
      .map((c) => {
        const bk = bookMap.get(String(c.bookId));
        return {
          id: Number(c.numericId),
          inventory_code: String(c.inventoryCode),
          barcode: String(c.barcode),
          book_title: String(c.bookTitle),
          shelf_id: c.shelfId ? Number(String(c.shelfId).replace('shelf_', '')) || null : null,
          shelf_code: c.shelfCode ? String(c.shelfCode) : null,
          condition: String(c.condition),
          status: String(c.status),
          is_reference_only: bk?.isReferenceOnly ? 1 : 0,
          read_in_place_only: bk?.readInPlaceOnly ? 1 : 0,
        };
      });

    const auditRows = audits
      .sort((a, b) => Number(b.numericId) - Number(a.numericId))
      .map((a) => ({
        id: Number(a.numericId),
        audit_number: String(a.auditNumber),
        title: String(a.title),
        shelf_code: a.shelfCode ? String(a.shelfCode) : null,
        status: String(a.status),
        total_expected: Number(a.totalExpected || 0),
        total_scanned: Number(a.totalScanned || 0),
        total_discrepancy: Number(a.totalDiscrepancy || 0),
        started_at: String(a.startedAt),
      }));

    let activeAuditItems: Array<Record<string, unknown>> = [];
    if (activeAuditId) {
      const target = audits.find((a) => String(a.numericId) === activeAuditId);
      activeAuditItems = ((target?.items as Array<Record<string, unknown>>) || []).map((it) => ({
        id: it.id,
        inventory_code: it.inventoryCode,
        book_title: it.bookTitle,
        expected_status: it.expectedStatus,
        physical_status: it.physicalStatus,
      }));
    }

    return jsonRes({
      locations: locations.map((l) => ({
        id: Number(l.numericId),
        code: String(l.code),
        building: String(l.building),
        floor: String(l.floor || ''),
        room: String(l.room),
      })),
      shelves: shelfRows,
      copies: copyRows,
      audits: auditRows,
      activeAuditItems,
    });
  }

  if (pathname === '/api/inventory' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const action = String(body?.action || '');

    if (action === 'create_shelf') {
      const [shelves, locations] = await Promise.all([
        listCollection('shelves'),
        listCollection('locations'),
      ]);
      const nextNum = nextNumericId(shelves);
      const loc =
        locations.find((l) => String(l.numericId) === String(body?.locationId || '1')) || locations[0];
      try {
        await setDoc(doc(db, 'shelves', `shelf_${nextNum}`), {
          numericId: nextNum,
          locationId: loc.id,
          code: clampString(body?.code, 32),
          name: clampString(body?.name, 120),
          capacity: Math.max(1, Number(body?.capacity || 150)),
          building: clampString(loc.building, 120),
          room: clampString(loc.room, 120),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `shelves/shelf_${nextNum}`);
      }
      return jsonRes({ ok: true });
    }

    if (action === 'transfer_copy') {
      const copyDocId = `copy_${Number(body?.copyId || 0)}`;
      const copy = await getDocument('book_copies', copyDocId);
      if (!copy) return jsonRes({ error: 'Eksemplar tidak ditemukan.' }, 404);
      const requestedStatus = clampString(body?.status, 30, String(copy.status));
      if (
        requestedStatus !== String(copy.status) &&
        (copy.status === 'Dipinjam' || copy.status === 'Direservasi')
      ) {
        return jsonRes(
          {
            error: `Status eksemplar '${copy.status}' tidak dapat ditimpa langsung. Selesaikan melalui Sirkulasi atau Reservasi.`,
          },
          400
        );
      }
      const shelves = await listCollection('shelves');
      const shelf = shelves.find((s) => String(s.numericId) === String(body?.shelfId || ''));
      try {
        await updateDoc(doc(db, 'book_copies', copyDocId), {
          shelfId: shelf ? shelf.id : '',
          shelfCode: shelf ? clampString(shelf.code, 64) : '',
          shelfName: shelf ? clampString(shelf.name, 120) : '',
          condition: clampString(body?.condition, 30, String(copy.condition)),
          status: requestedStatus,
          updatedAt: serverTimestamp(),
        });
        await syncPublicCatalogForBook(String(copy.bookId));
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `book_copies/${copyDocId}`);
      }
      return jsonRes({ ok: true });
    }

    if (action === 'start_audit') {
      const [audits, shelves, copies] = await Promise.all([
        listCollection('inventory_audits'),
        listCollection('shelves'),
        listCollection('book_copies', [where('archived', '==', false)]),
      ]);
      const nextNum = nextNumericId(audits);
      const auditDocId = `audit_${nextNum}`;
      const auditNumber = `OPN-2026-${String(nextNum).padStart(4, '0')}`;
      const shelf = shelves.find((s) => String(s.numericId) === String(body?.shelfId || ''));
      const expectedCount = copies.filter(
        (c) => c.status !== 'Dihapus' && (!shelf || c.shelfId === shelf.id)
      ).length;

      try {
        await setDoc(doc(db, 'inventory_audits', auditDocId), {
          numericId: nextNum,
          auditNumber,
          title: clampString(body?.title, 200, 'Stock Opname'),
          shelfId: shelf ? shelf.id : '',
          shelfCode: shelf ? clampString(shelf.code, 64) : '',
          conductedByUid: actor.uid,
          conductedByName: clampString(actor.fullName, 120),
          startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          completedAt: '',
          status: 'Berlangsung',
          totalExpected: expectedCount,
          totalScanned: 0,
          totalDiscrepancy: 0,
          notes: '',
          items: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `inventory_audits/${auditDocId}`);
      }
      return jsonRes({ ok: true, id: nextNum, auditNumber });
    }

    if (action === 'scan_audit_item') {
      const auditDocId = `audit_${Number(body?.auditId || 0)}`;
      const term = String(body?.code || '').trim().toLowerCase();
      const [audit, copies] = await Promise.all([
        getDocument('inventory_audits', auditDocId),
        listCollection('book_copies', [where('archived', '==', false)]),
      ]);
      if (!audit) return jsonRes({ error: 'Sesi opname tidak ditemukan.' }, 404);
      if (audit.status !== 'Berlangsung') {
        return jsonRes(
          { error: 'Sesi stock opname ini sudah selesai dan tidak menerima pemindaian baru.' },
          400
        );
      }
      const copy = copies.find(
        (c) => String(c.inventoryCode).toLowerCase() === term || String(c.barcode).toLowerCase() === term
      );
      if (!copy) return jsonRes({ error: 'Kode inventaris / barcode tidak ditemukan.' }, 404);

      const items = [...((audit.items as Array<Record<string, unknown>>) || [])];
      const existingIdx = items.findIndex((i) => i.copyId === copy.id);
      const entry = {
        id: existingIdx >= 0 ? items[existingIdx].id : items.length + 1,
        copyId: copy.id,
        inventoryCode: String(copy.inventoryCode),
        bookTitle: String(copy.bookTitle),
        expectedStatus: String(copy.status),
        physicalStatus: clampString(body?.physicalStatus, 40, 'Ditemukan'),
      };
      if (existingIdx >= 0) items[existingIdx] = entry;
      else items.push(entry);

      try {
        await updateDoc(doc(db, 'inventory_audits', auditDocId), {
          items,
          totalScanned: items.length,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `inventory_audits/${auditDocId}`);
      }
      return jsonRes({ ok: true, inventoryCode: copy.inventoryCode });
    }

    if (action === 'complete_audit') {
      const auditDocId = `audit_${Number(body?.auditId || 0)}`;
      const [audit, copies] = await Promise.all([
        getDocument('inventory_audits', auditDocId),
        listCollection('book_copies', [where('archived', '==', false)]),
      ]);
      if (!audit) return jsonRes({ error: 'Sesi opname tidak ditemukan.' }, 404);
      if (audit.status !== 'Berlangsung') {
        return jsonRes({ error: 'Sesi stock opname ini sudah diselesaikan sebelumnya.' }, 400);
      }
      const targetCopies = copies.filter(
        (c) => c.status !== 'Dihapus' && (!audit.shelfId || c.shelfId === audit.shelfId)
      );
      const scannedItems = ((audit.items as Array<Record<string, unknown>>) || []).map((i) => ({
        copy_id: Number(String(i.copyId).replace('copy_', '')) || 0,
        physical_status: String(i.physicalStatus),
      }));
      const discrepancy = computeStockOpnameDiscrepancy(
        targetCopies.map((c) => ({ id: Number(c.numericId), status: String(c.status) })),
        scannedItems
      );
      try {
        await updateDoc(doc(db, 'inventory_audits', auditDocId), {
          status: 'Selesai',
          totalDiscrepancy: discrepancy.totalDiscrepancy,
          completedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `inventory_audits/${auditDocId}`);
      }
      return jsonRes({ ok: true, discrepancy });
    }
  }

  // 10. /api/acquisitions
  if (pathname === '/api/acquisitions' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const [acquisitions, suppliers, shelves] = await Promise.all([
      listCollection('acquisitions'),
      listCollection('suppliers'),
      listCollection('shelves'),
    ]);
    return jsonRes({
      acquisitions: acquisitions
        .sort((a, b) => Number(b.numericId) - Number(a.numericId))
        .map((a) => ({
          id: Number(a.numericId),
          request_number: String(a.requestNumber),
          title_summary: String(a.titleSummary),
          supplier_name: a.supplierName ? String(a.supplierName) : null,
          requested_by_name: a.requestedByName ? String(a.requestedByName) : null,
          approved_by_name: a.approvedByName ? String(a.approvedByName) : null,
          total_estimated_cost: Number(a.totalEstimatedCost || 0),
          status: String(a.status),
          created_at: tsToIso(a.createdAt),
          items: ((a.items as Array<Record<string, unknown>>) || []).map((it) => ({
            id: Number(it.id || 1),
            title: String(it.title),
            author_name: String(it.authorName || ''),
            quantity_ordered: Number(it.quantityOrdered || 1),
            quantity_received: Number(it.quantityReceived || 0),
            unit_price: Number(it.unitPrice || 0),
          })),
        })),
      suppliers: suppliers
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((s) => ({
          id: Number(s.numericId),
          code: String(s.code),
          name: String(s.name),
          contact_person: String(s.contactPerson || ''),
          phone: String(s.phone || ''),
        })),
      shelves: shelves
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((s) => ({
          id: Number(s.numericId),
          code: String(s.code),
          name: String(s.name),
        })),
    });
  }

  if (pathname === '/api/acquisitions' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const action = String(body?.action || '');

    if (action === 'create_supplier') {
      const suppliers = await listCollection('suppliers');
      const nextNum = nextNumericId(suppliers);
      try {
        await setDoc(doc(db, 'suppliers', `sup_${nextNum}`), {
          numericId: nextNum,
          code: `SUP-${String(nextNum).padStart(3, '0')}`,
          name: clampString(body?.name, 140),
          contactPerson: clampString(body?.contactPerson, 120, ''),
          phone: clampString(body?.phone, 40, ''),
          email: '',
          address: '',
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `suppliers/sup_${nextNum}`);
      }
      return jsonRes({ ok: true });
    }

    if (action === 'create_request') {
      const [acquisitions, suppliers] = await Promise.all([
        listCollection('acquisitions'),
        listCollection('suppliers'),
      ]);
      const nextNum = nextNumericId(acquisitions);
      const reqDocId = `acq_${nextNum}`;
      const requestNumber = `PGD-2026-${String(nextNum).padStart(4, '0')}`;
      const sup = suppliers.find((s) => String(s.numericId) === String(body?.supplierId || ''));
      const rawItems = (body?.items as Array<Record<string, unknown>>) || [];
      const items = rawItems.map((it, idx) => ({
        id: idx + 1,
        title: clampString(it.title, 240, 'Judul Baru'),
        isbn: clampString(it.isbn, 40, ''),
        authorName: clampString(it.authorName, 120, 'Tim Penulis'),
        publisherName: sup ? clampString(sup.name, 120) : 'Pustaka Sekolah',
        categoryName: 'Cerita Anak & Dongeng',
        quantityOrdered: Math.max(1, Number(it.quantity || 1)),
        quantityReceived: 0,
        unitPrice: Math.max(0, Number(it.unitPrice || 50000)),
        status: 'Menunggu',
      }));
      const totalEstimatedCost = items.reduce(
        (s, it) => s + it.quantityOrdered * it.unitPrice,
        0
      );

      try {
        await setDoc(doc(db, 'acquisitions', reqDocId), {
          numericId: nextNum,
          requestNumber,
          titleSummary: clampString(body?.titleSummary, 240),
          supplierId: sup ? sup.id : '',
          supplierName: sup ? clampString(sup.name, 140) : '',
          requestedByUid: actor.uid,
          requestedByName: clampString(actor.fullName, 120),
          approvedByUid: '',
          approvedByName: '',
          orderDate: '',
          receivedDate: '',
          totalEstimatedCost,
          status: 'Menunggu Persetujuan',
          notes: '',
          items,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `acquisitions/${reqDocId}`);
      }
      return jsonRes({ ok: true, requestNumber });
    }

    const acqDocId = `acq_${Number(body?.acquisitionId || 0)}`;
    const acq = await getDocument('acquisitions', acqDocId);
    if (!acq) return jsonRes({ error: 'Pengadaan tidak ditemukan.' }, 404);

    if (action === 'approve' || action === 'reject') {
      if (!actor.permissions.includes('*') && !actor.permissions.includes('acquisitions.approve')) {
        return jsonRes({ error: 'Hanya Kepala Perpustakaan / Admin yang dapat menyetujui.' }, 403);
      }
      if (acq.status !== 'Diajukan' && acq.status !== 'Menunggu Persetujuan') {
        return jsonRes(
          { error: `Usulan berstatus '${acq.status}' tidak dapat diproses persetujuannya.` },
          400
        );
      }
      try {
        await updateDoc(doc(db, 'acquisitions', acqDocId), {
          status: action === 'approve' ? 'Disetujui' : 'Ditolak',
          approvedByUid: actor.uid,
          approvedByName: clampString(actor.fullName, 120),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `acquisitions/${acqDocId}`);
      }
      return jsonRes({ ok: true });
    }

    if (action === 'mark_ordered') {
      if (acq.status !== 'Disetujui') {
        return jsonRes(
          { error: 'Hanya usulan berstatus Disetujui yang dapat ditandai dipesan.' },
          400
        );
      }
      try {
        await updateDoc(doc(db, 'acquisitions', acqDocId), {
          status: 'Dipesan',
          orderDate: todayStr,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `acquisitions/${acqDocId}`);
      }
      return jsonRes({ ok: true });
    }

    if (action === 'receive') {
      if (acq.status !== 'Disetujui' && acq.status !== 'Dipesan') {
        return jsonRes(
          { error: `Pengadaan berstatus '${acq.status}' tidak dapat diterima ke katalog.` },
          400
        );
      }
      const [books, copies, shelves, categories] = await Promise.all([
        listCollection('books'),
        listCollection('book_copies'),
        listCollection('shelves'),
        listCategories(),
      ]);
      const shelf =
        shelves.find((s) => String(s.numericId) === String(body?.shelfId || '')) || shelves[0];
      let nextBookNum = nextNumericId(books);
      let nextCopyNum = nextNumericId(copies);
      const items = [...((acq.items as Array<Record<string, unknown>>) || [])];
      const batch = writeBatch(db);

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const qty = Math.max(1, Number(it.quantityOrdered || 1));
        const bNum = nextBookNum++;
        const bookDocId = `book_${bNum}`;
        const cat = categories[0];

        batch.set(doc(db, 'books', bookDocId), {
          numericId: bNum,
          title: clampString(it.title, 240),
          isbn: clampString(it.isbn, 40, ''),
          edition: 'Pengadaan Baru',
          publishYear: 2025,
          language: 'Indonesia',
          description: `Hasil pengadaan ${acq.requestNumber}.`,
          pages: 80,
          coverUrl: '/images/cover-cerita-anak.jpg',
          price: Number(it.unitPrice || 50000),
          categoryId: cat ? cat.id : '',
          categoryName: cat ? clampString(cat.name, 120) : '',
          publisherName: clampString(it.publisherName, 120, 'Pustaka Sekolah'),
          authors: clampString(it.authorName, 200, 'Tim Penulis'),
          subcategory: '',
          isReferenceOnly: false,
          readInPlaceOnly: false,
          acquisitionDate: todayStr,
          borrowCount: 0,
          archived: false,
          createdByUid: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'public_catalog', bookDocId), {
          numericId: bNum,
          title: clampString(it.title, 240),
          isbn: clampString(it.isbn, 40, ''),
          edition: 'Pengadaan Baru',
          publishYear: 2025,
          language: 'Indonesia',
          description: `Hasil pengadaan ${acq.requestNumber}.`,
          pages: 80,
          coverUrl: '/images/cover-cerita-anak.jpg',
          categoryId: cat ? cat.id : '',
          categoryName: cat ? clampString(cat.name, 120) : '',
          publisherName: clampString(it.publisherName, 120, 'Pustaka Sekolah'),
          authors: clampString(it.authorName, 200, 'Tim Penulis'),
          subcategory: '',
          isReferenceOnly: false,
          readInPlaceOnly: false,
          totalCopies: qty,
          availableCopies: qty,
          shelfLocations: shelf ? `${shelf.code} (${shelf.name})` : '',
          borrowCount: 0,
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        for (let k = 0; k < qty; k++) {
          const cNum = nextCopyNum++;
          batch.set(doc(db, 'book_copies', `copy_${cNum}`), {
            numericId: cNum,
            bookId: bookDocId,
            bookTitle: clampString(it.title, 240),
            inventoryCode: `LP-2026-${String(cNum).padStart(4, '0')}`,
            barcode: `BC${String(20260000 + cNum)}`,
            shelfId: shelf ? shelf.id : '',
            shelfCode: shelf ? clampString(shelf.code, 64) : '',
            shelfName: shelf ? clampString(shelf.name, 120) : '',
            condition: 'Baik',
            status: 'Tersedia',
            acquisitionDate: todayStr,
            price: Number(it.unitPrice || 50000),
            notes: `Pengadaan ${acq.requestNumber}`,
            archived: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        items[idx] = { ...it, quantityReceived: qty, status: 'Diterima' };
      }

      batch.update(doc(db, 'acquisitions', acqDocId), {
        status: 'Selesai',
        receivedDate: todayStr,
        items,
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
        await writeAuditLog(actor, 'ACQUISITION_RECEIVE', 'acquisitions', acqDocId, `Penerimaan ${acq.requestNumber}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `acquisitions/${acqDocId}`);
      }
      return jsonRes({ ok: true });
    }
  }

  // 11. /api/reports
  if (pathname === '/api/reports' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const type = searchParams.get('type') || 'loans';
    const fromDate = searchParams.get('fromDate') || '2026-01-01';
    const toDate = searchParams.get('toDate') || '2026-12-31';
    const catFilter = searchParams.get('categoryId') || '';

    const [books, copies, members, loans, returns, fines, payments, acquisitions, categories] =
      await Promise.all([
        listCollection('books', [where('archived', '==', false)]),
        listCollection('book_copies', [where('archived', '==', false)]),
        listCollection('members', [where('archived', '==', false)]),
        listCollection('loans'),
        listCollection('returns'),
        listCollection('fines'),
        listCollection('payments'),
        listCollection('acquisitions'),
        listCategories(),
      ]);

    const filteredBooks = catFilter
      ? books.filter((b) => String(b.categoryId) === `cat_${catFilter}` || b.categoryId === catFilter)
      : books;

    let rows: Array<Record<string, unknown>> = [];
    if (type === 'loans') {
      rows = loans
        .filter((l) => String(l.loanDate) >= fromDate && String(l.loanDate) <= toDate)
        .map((l) => ({
          No_Pinjam: l.loanNumber,
          Anggota: l.memberName,
          Tanggal_Pinjam: l.loanDate,
          Jatuh_Tempo: l.dueDate,
          Jumlah_Buku: Array.isArray(l.items) ? l.items.length : 1,
          Status: l.status,
        }));
    } else if (type === 'returns') {
      rows = returns
        .filter((r) => String(r.returnedAt) >= fromDate && String(r.returnedAt) <= toDate)
        .map((r) => ({
          No_Kembali: r.returnNumber,
          No_Pinjam: r.loanNumber,
          Anggota: r.memberName,
          Judul_Buku: r.bookTitle,
          Tanggal_Kembali: r.returnedAt,
          Kondisi: r.condition,
          Denda: r.fineAmount,
          Status: r.status,
        }));
    } else if (type === 'overdue') {
      for (const l of loans) {
        for (const it of (l.items as Array<Record<string, unknown>>) || []) {
          if (!it.returnedAt && String(it.dueDate || l.dueDate) < todayStr) {
            rows.push({
              No_Pinjam: l.loanNumber,
              Anggota: l.memberName,
              Judul_Buku: it.bookTitle,
              Kode_Eksemplar: it.inventoryCode,
              Jatuh_Tempo: it.dueDate,
            });
          }
        }
      }
    } else if (type === 'collection' || type === 'available') {
      rows = filteredBooks.map((b) => {
        const bCopies = copies.filter((c) => c.bookId === b.id);
        const avail = bCopies.filter((c) => c.status === 'Tersedia').length;
        return {
          Judul: b.title,
          ISBN: b.isbn,
          Kategori: b.categoryName,
          Total_Eksemplar: bCopies.length,
          Tersedia: avail,
        };
      }).filter((r) => (type === 'available' ? r.Tersedia > 0 : true));
    } else if (type === 'active_members') {
      rows = members
        .filter((m) => m.status === 'Aktif')
        .map((m) => ({
          Nomor_Anggota: m.memberCode,
          Nama: m.fullName,
          Jenis: m.membershipTypeName,
          Kelas_Unit: m.unitOrClass,
          Berlaku_Hingga: m.expiresAt,
        }));
    } else if (type === 'most_active_members') {
      rows = members
        .map((m) => ({
          Nomor_Anggota: m.memberCode,
          Nama: m.fullName,
          Total_Pinjaman: loans.filter((l) => l.memberId === m.id).length,
        }))
        .sort((a, b) => b.Total_Pinjaman - a.Total_Pinjaman);
    } else if (type === 'popular_books') {
      rows = [...filteredBooks]
        .sort((a, b) => Number(b.borrowCount || 0) - Number(a.borrowCount || 0))
        .map((b) => ({
          Judul: b.title,
          Kategori: b.categoryName,
          Total_Dipinjam: Number(b.borrowCount || 0),
        }));
    } else if (type === 'popular_categories') {
      rows = categories.map((c) => ({
        Kategori: c.name,
        Jumlah_Judul: books.filter((b) => b.categoryId === c.id).length,
        Total_Dipinjam: books
          .filter((b) => b.categoryId === c.id)
          .reduce((s, b) => s + Number(b.borrowCount || 0), 0),
      }));
    } else if (type === 'fines') {
      rows = fines.map((f) => ({
        No_Denda: f.fineNumber,
        Anggota: f.memberName,
        Jenis: f.fineType,
        Tagihan: f.amount,
        Dibayar: f.paidAmount,
        Status: f.status,
      }));
    } else if (type === 'payments') {
      rows = payments.map((p) => ({
        No_Bayar: p.paymentNumber,
        No_Denda: p.fineNumber,
        Anggota: p.memberName,
        Nominal: p.amount,
        Metode: p.method,
        Tanggal: p.paidAt,
      }));
    } else if (type === 'acquisitions') {
      rows = acquisitions.map((a) => ({
        No_Pengadaan: a.requestNumber,
        Ringkasan: a.titleSummary,
        Pemasok: a.supplierName,
        Estimasi: a.totalEstimatedCost,
        Status: a.status,
      }));
    } else if (type === 'inventory') {
      rows = copies.map((c) => ({
        Kode_Inventaris: c.inventoryCode,
        Judul: c.bookTitle,
        Rak: c.shelfCode,
        Kondisi: c.condition,
        Status: c.status,
      }));
    } else if (type === 'lost_damaged') {
      rows = copies
        .filter((c) => c.condition !== 'Baik' || c.status === 'Hilang' || c.status === 'Perbaikan')
        .map((c) => ({
          Kode_Inventaris: c.inventoryCode,
          Judul: c.bookTitle,
          Kondisi: c.condition,
          Status: c.status,
        }));
    }

    return jsonRes({
      rows,
      categories: categories.map((c) => ({ id: Number(c.numericId), name: String(c.name) })),
    });
  }

  // 12. /api/notifications
  if (pathname === '/api/notifications' && method === 'GET') {
    const notifs = isStaff
      ? await listCollection('notifications')
      : await listCollection('notifications', [where('targetUid', '==', actor.uid)]);
    const rows = notifs
      .sort((a, b) => Number(b.numericId) - Number(a.numericId))
      .map((n) => ({
        id: Number(n.numericId),
        docId: n.id,
        type: String(n.type),
        title: String(n.title),
        message: String(n.message),
        link: String(n.link || ''),
        is_read: n.isRead ? 1 : 0,
        created_at: tsToIso(n.createdAt),
      }));
    return jsonRes({ notifications: rows });
  }

  if (pathname === '/api/notifications' && method === 'PATCH') {
    const action = String(body?.action || '');
    const notifs = isStaff
      ? await listCollection('notifications')
      : await listCollection('notifications', [where('targetUid', '==', actor.uid)]);

    if (action === 'mark_all_read') {
      const batch = writeBatch(db);
      for (const n of notifs.filter((x) => !x.isRead)) {
        batch.update(doc(db, 'notifications', n.id), {
          isRead: true,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      return jsonRes({ ok: true });
    }

    if (action === 'scan_alerts') {
      if (!isStaff) {
        return jsonRes({ error: 'Hanya petugas yang dapat memindai pengingat sistem.' }, 403);
      }
      const [loans, acqs] = await Promise.all([
        listCollection('loans'),
        listCollection('acquisitions'),
      ]);
      let generated = 0;
      const globalSet = await getDocument('library_settings', 'global');
      const notifPolicy = extractCirculationPolicy(
        (globalSet?.values as Record<string, string>) || {}
      );
      const dueSoonLimit = addDaysIso(todayStr, notifPolicy.autoReminderDaysBeforeDue);
      let nextNum = nextNumericId(notifs);
      const batch = writeBatch(db);

      for (const l of loans) {
        const activeItems = ((l.items as Array<Record<string, unknown>>) || []).filter(
          (i) => !i.returnedAt
        );
        const overdue = activeItems.some((i) => String(i.dueDate || l.dueDate) < todayStr);
        if (overdue && !notifs.some((n) => String(n.message).includes(String(l.loanNumber)))) {
          const num = nextNum++;
          batch.set(doc(db, 'notifications', `notif_${num}`), {
            numericId: num,
            targetUid: '',
            targetRole: 'all_staff',
            memberId: String(l.memberId),
            type: 'warning',
            title: 'Keterlambatan Terdeteksi',
            message: `Transaksi ${l.loanNumber} (${l.memberName}) melewati tanggal jatuh tempo.`,
            link: '/returns',
            isRead: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          generated++;
        } else if (
          !overdue &&
          activeItems.some((i) => {
            const d = String(i.dueDate || l.dueDate);
            return d >= todayStr && d <= dueSoonLimit;
          }) &&
          !notifs.some(
            (n) =>
              n.title === 'Mendekati Jatuh Tempo' &&
              String(n.message).includes(String(l.loanNumber))
          )
        ) {
          const num = nextNum++;
          batch.set(doc(db, 'notifications', `notif_${num}`), {
            numericId: num,
            targetUid: String(l.ownerUid || ''),
            targetRole: l.ownerUid ? '' : 'all_staff',
            memberId: String(l.memberId),
            type: 'info',
            title: 'Mendekati Jatuh Tempo',
            message: `Pinjaman ${l.loanNumber} jatuh tempo pada ${String(l.dueDate)}.`,
            link: '/loans',
            isRead: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          generated++;
        }
      }
      for (const a of acqs) {
        if (
          a.status === 'Menunggu Persetujuan' &&
          !notifs.some((n) => String(n.message).includes(String(a.requestNumber)))
        ) {
          const num = nextNum++;
          batch.set(doc(db, 'notifications', `notif_${num}`), {
            numericId: num,
            targetUid: '',
            targetRole: 'kepala_perpustakaan',
            memberId: '',
            type: 'info',
            title: 'Persetujuan Pengadaan',
            message: `Usulan ${a.requestNumber} menunggu persetujuan Kepala Perpustakaan.`,
            link: '/acquisitions',
            isRead: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          generated++;
        }
      }
      if (generated > 0) await batch.commit();
      return jsonRes({ ok: true, generated });
    }

    const singleId = Number(body?.id || 0);
    const target = notifs.find((n) => Number(n.numericId) === singleId);
    if (target) {
      await updateDoc(doc(db, 'notifications', target.id), {
        isRead: true,
        updatedAt: serverTimestamp(),
      });
    }
    return jsonRes({ ok: true });
  }

  // 13. /api/settings (plus Google Auth staff_roles & custom RBAC management)
  if (pathname === '/api/settings' && method === 'GET') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const [globalSet, rbacSet, mTypes, members, auditLogs, users, staffRoles, snapshots] =
      await Promise.all([
        getDocument('library_settings', 'global'),
        getDocument('library_settings', 'rbac'),
        listCollection('membership_types'),
        listCollection('members'),
        listCollection('audit_logs'),
        listCollection('users'),
        actor.roleSlug === 'super_admin' ? listCollection('staff_roles') : Promise.resolve([]),
        actor.roleSlug === 'super_admin'
          ? listCollection('backup_snapshots').catch(() => [])
          : Promise.resolve([]),
      ]);

    const baseRoles = [
      { id: 1, slug: 'super_admin', name: 'Super Admin', description: 'Akses penuh sistem, RBAC & backup' },
      { id: 2, slug: 'kepala_perpustakaan', name: 'Kepala Perpustakaan', description: 'Persetujuan pengadaan, waive denda & laporan' },
      { id: 3, slug: 'pustakawan', name: 'Pustakawan / Petugas', description: 'Operasional sirkulasi, katalog & jadwal baca' },
      { id: 4, slug: 'anggota', name: 'Siswa / Guru', description: 'OPAC & pinjaman pribadi' },
    ];
    const customRolesMap =
      (rbacSet?.customRoles as Record<string, { id?: number; name: string; description?: string }>) || {};
    const customRoles = Object.entries(customRolesMap).map(([slug, meta], idx) => ({
      id: Number(meta.id || 5 + idx),
      slug,
      name: String(meta.name || slug),
      description: String(meta.description || ''),
    }));
    const allRoles = [...baseRoles, ...customRoles];

    const permCodes = Array.from(
      new Set(Object.values(ROLE_PERMISSION_DEFAULTS).flat().filter((p) => p !== '*'))
    );
    const permissions = permCodes.map((code, i) => ({
      id: i + 1,
      code,
      name: code,
      module: code.split('.')[0],
    }));

    const rpMatrix = (rbacSet?.rolePermissions as Record<string, string[]>) || ROLE_PERMISSION_DEFAULTS;
    const rolePermissions: Array<{ role_id: number; permission_id: number }> = [];
    for (const r of allRoles) {
      const granted = rpMatrix[r.slug] || [];
      for (const p of permissions) {
        if (granted.includes('*') || granted.includes(p.code)) {
          rolePermissions.push({ role_id: r.id, permission_id: p.id });
        }
      }
    }

    const roles = allRoles.map((r) => ({
      ...r,
      user_count: users.filter((u) => String(u.role) === r.slug).length,
      permission_count: rolePermissions.filter((rp) => rp.role_id === r.id).length,
    }));

    const rawVals = (globalSet?.values as Record<string, string>) || {};
    const mergedSettings: Record<string, string> = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...rawVals,
    };
    if (!rawVals.operational_hours && rawVals.operating_hours) {
      mergedSettings.operational_hours = rawVals.operating_hours;
    }
    if (!rawVals.reservation_expiry_days && rawVals.reservation_pickup_hours) {
      mergedSettings.reservation_expiry_days = String(
        Math.max(1, Math.ceil(parseNumberSetting(rawVals.reservation_pickup_hours, 72, 24) / 24))
      );
    }

    const sortedSnaps = snapshots
      .map((s) => ({ createdAt: tsToIso(s.createdAt) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const lastSnapshotAt = sortedSnaps[0]?.createdAt || null;

    return jsonRes({
      settings: mergedSettings,
      membershipTypes: mTypes
        .sort((a, b) => Number(a.numericId) - Number(b.numericId))
        .map((mt) => ({
          id: Number(mt.numericId),
          code: String(mt.code),
          name: String(mt.name),
          max_loans: Number(mt.maxLoans),
          loan_duration_days: Number(mt.loanDurationDays),
          max_renewals: Number(mt.maxRenewals),
          daily_fine_rate: Number(mt.dailyFineRate),
          max_fine_cap: Number(mt.maxFineCap),
          allow_reservation: mt.allowReservation ? 1 : 0,
          member_count: members.filter(
            (m) => !m.archived && String(m.membershipTypeId) === `mtype_${Number(mt.numericId)}`
          ).length,
        })),
      roles,
      permissions,
      rolePermissions,
      users: users.map((u, i) => ({
        id: i + 1,
        uid: u.id,
        username: String(u.email).split('@')[0],
        email: String(u.email),
        full_name: String(u.fullName),
        is_active: u.isActive ? 1 : 0,
        role_id: roles.find((r) => r.slug === u.role)?.id || 4,
        role_name: roles.find((r) => r.slug === u.role)?.name || String(u.role),
        role_slug: String(u.role),
        created_at: tsToIso(u.createdAt),
      })),
      staffRoles: staffRoles.map((sr) => ({
        uid: sr.id,
        email: String(sr.email),
        fullName: String(sr.fullName),
        role: String(sr.role),
        isActive: Boolean(sr.isActive),
      })),
      auditLogs: auditLogs
        .map((l, idx) => ({
          id: idx + 1,
          user_name: String(l.userName),
          action: String(l.action),
          entity_type: String(l.entityType),
          entity_id: String(l.entityId),
          after_json: l.summary ? JSON.stringify({ summary: String(l.summary) }) : null,
          before_json: null,
          created_at: tsToIso(l.createdAt),
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 300),
      backupSummary: {
        snapshotCount: snapshots.length,
        lastSnapshotAt,
        health: evaluateBackupHealth(
          lastSnapshotAt,
          mergedSettings.backup_auto_frequency || 'weekly'
        ),
      },
    });
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    if (!actor.permissions.includes('*') && !actor.permissions.includes('settings.write')) {
      return jsonRes({ error: 'Hanya Super Admin yang dapat mengubah pengaturan.' }, 403);
    }
    const section = String(body?.section || '');

    if (section === 'general') {
      const incoming = (body?.settings as Record<string, string>) || {};
      const globalDoc = await getDocument('library_settings', 'global');
      const merged: Record<string, string> = {
        ...DEFAULT_SYSTEM_SETTINGS,
        ...((globalDoc?.values as Record<string, string>) || {}),
        ...incoming,
      };
      if (incoming.operational_hours !== undefined) {
        merged.operating_hours = incoming.operational_hours;
      }
      if (incoming.reservation_expiry_days !== undefined) {
        const days = Math.max(1, parseNumberSetting(incoming.reservation_expiry_days, 3, 1, 30));
        merged.reservation_pickup_hours = String(days * 24);
      }
      if (incoming.auto_reminder_days_before_due !== undefined) {
        merged.notify_due_days_before = incoming.auto_reminder_days_before_due;
      }
      await updateDoc(doc(db, 'library_settings', 'global'), {
        values: merged,
        updatedByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'SETTINGS_UPDATE', 'library_settings', 'global', 'Perbarui identitas, aturan & kebijakan backup');
      return jsonRes({ ok: true });
    }

    if (section === 'membership_type') {
      const mt = (body?.membershipType as Record<string, unknown>) || {};
      const payload = {
        name: clampString(mt.name, 100),
        max_loans: Number(mt.max_loans || 3),
        loan_duration_days: Number(mt.loan_duration_days || 7),
        max_renewals: Number(mt.max_renewals ?? 1),
        daily_fine_rate: Number(mt.daily_fine_rate ?? 500),
        max_fine_cap: Number(mt.max_fine_cap ?? 15000),
      };
      const check = validateMembershipPolicyInput(payload);
      if (!check.ok) return jsonRes({ error: check.reason }, 400);

      const mtypeDocId = `mtype_${Number(mt.id)}`;
      const [prevMtype, globalDoc] = await Promise.all([
        getDocument('membership_types', mtypeDocId),
        getDocument('library_settings', 'global'),
      ]);
      const policyMode = extractCirculationPolicy(
        (globalDoc?.values as Record<string, string>) || {}
      ).policyApplicationMode;

      await updateDoc(doc(db, 'membership_types', mtypeDocId), {
        name: payload.name,
        maxLoans: payload.max_loans,
        loanDurationDays: payload.loan_duration_days,
        maxRenewals: payload.max_renewals,
        dailyFineRate: payload.daily_fine_rate,
        maxFineCap: payload.max_fine_cap,
        allowReservation: mt.allow_reservation === false || mt.allow_reservation === 0 ? false : true,
        updatedAt: serverTimestamp(),
      });

      if (policyMode === 'apply_to_active') {
        const [members, loans] = await Promise.all([
          listCollection('members'),
          listCollection('loans'),
        ]);
        const targetMemberIds = new Set(
          members.filter((m) => String(m.membershipTypeId) === mtypeDocId).map((m) => m.id)
        );
        const durationChanged =
          Number(prevMtype?.loanDurationDays || payload.loan_duration_days) !==
          payload.loan_duration_days;
        const activeLoans = loans.filter(
          (l) =>
            targetMemberIds.has(String(l.memberId)) &&
            ['Aktif', 'Terlambat', 'Sebagian Kembali'].includes(String(l.status))
        );
        for (const loan of activeLoans) {
          const items = ((loan.items as Array<Record<string, unknown>>) || []).map((it) => {
            if (!it.returnedAt && durationChanged && Number(it.renewalCount || 0) === 0) {
              const recalculatedDue = addDaysIso(String(loan.loanDate), payload.loan_duration_days);
              return {
                ...it,
                dueDate: recalculatedDue,
                status: recalculatedDue < todayStr ? 'Terlambat' : 'Dipinjam',
              };
            }
            return it;
          });
          const activeDueDates = items
            .filter((i) => !i.returnedAt)
            .map((i) => String(i.dueDate || loan.dueDate));
          const maxDue = activeDueDates.sort().slice(-1)[0] || String(loan.dueDate);
          const hasOverdue = activeDueDates.some((d) => d < todayStr);
          const hasReturned = items.some((i) => Boolean(i.returnedAt));
          await updateDoc(doc(db, 'loans', loan.id), {
            maxRenewals: payload.max_renewals,
            dueDate: maxDue,
            status: hasOverdue ? 'Terlambat' : hasReturned ? 'Sebagian Kembali' : 'Aktif',
            items,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await writeAuditLog(actor, 'POLICY_UPDATE', 'membership_type', String(mt.id), `Perbarui kebijakan ${payload.name}`);
      return jsonRes({ ok: true });
    }

    if (section === 'membership_type_create') {
      const mt = (body?.membershipType as Record<string, unknown>) || {};
      const code = clampString(mt.code, 40).toUpperCase();
      const payload = {
        code,
        name: clampString(mt.name, 100),
        max_loans: Number(mt.max_loans || 3),
        loan_duration_days: Number(mt.loan_duration_days || 7),
        max_renewals: Number(mt.max_renewals ?? 1),
        daily_fine_rate: Number(mt.daily_fine_rate ?? 500),
        max_fine_cap: Number(mt.max_fine_cap ?? 15000),
      };
      const check = validateMembershipPolicyInput(payload);
      if (!check.ok) return jsonRes({ error: check.reason }, 400);

      const existing = await listCollection('membership_types');
      if (existing.some((e) => String(e.code).toUpperCase() === code)) {
        return jsonRes({ error: `Kode jenis anggota '${code}' sudah terdaftar.` }, 409);
      }
      const nextId = existing.reduce((max, e) => Math.max(max, Number(e.numericId || 0)), 0) + 1;
      await setDoc(doc(db, 'membership_types', `mtype_${nextId}`), {
        numericId: nextId,
        code,
        name: payload.name,
        maxLoans: payload.max_loans,
        loanDurationDays: payload.loan_duration_days,
        maxRenewals: payload.max_renewals,
        dailyFineRate: payload.daily_fine_rate,
        maxFineCap: payload.max_fine_cap,
        allowReservation: mt.allow_reservation === false || mt.allow_reservation === 0 ? false : true,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'POLICY_CREATE', 'membership_type', String(nextId), `Tambah jenis anggota ${payload.name}`);
      return jsonRes({ ok: true, id: nextId });
    }

    if (section === 'create_role') {
      const name = clampString(body?.name, 60);
      const description = clampString(body?.description, 240);
      const check = validateCustomRoleInput({
        slug: typeof body?.slug === 'string' ? body.slug : undefined,
        name,
        description,
      });
      if (!check.ok || !check.normalizedSlug) {
        return jsonRes({ error: check.reason }, 400);
      }
      const rbacDoc = await getDocument('library_settings', 'rbac');
      const customRoles = {
        ...((rbacDoc?.customRoles as Record<string, { id: number; name: string; description: string }>) || {}),
      };
      if (customRoles[check.normalizedSlug]) {
        return jsonRes({ error: `Peran '${check.normalizedSlug}' sudah ada.` }, 409);
      }
      const nextId =
        Object.values(customRoles).reduce((m, r) => Math.max(m, Number(r.id || 4)), 4) + 1;
      customRoles[check.normalizedSlug] = { id: nextId, name, description };

      const matrix = {
        ...((rbacDoc?.rolePermissions as Record<string, string[]>) || ROLE_PERMISSION_DEFAULTS),
      };
      const cloneFromRoleId = body?.cloneFromRoleId ? Number(body.cloneFromRoleId) : null;
      const baseSlugs = ['super_admin', 'kepala_perpustakaan', 'pustakawan', 'anggota'];
      let cloned: string[] = [];
      if (cloneFromRoleId) {
        const srcSlug =
          baseSlugs[cloneFromRoleId - 1] ||
          Object.entries(customRoles).find(([, v]) => v.id === cloneFromRoleId)?.[0];
        if (srcSlug && matrix[srcSlug]) {
          cloned = matrix[srcSlug].filter((c) => c !== '*');
        }
      }
      matrix[check.normalizedSlug] = cloned;

      await updateDoc(doc(db, 'library_settings', 'rbac'), {
        customRoles,
        rolePermissions: matrix,
        updatedByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'RBAC_ROLE_CREATE', 'role', check.normalizedSlug, `Buat peran kustom ${name}`);
      return jsonRes({ ok: true, id: nextId, slug: check.normalizedSlug });
    }

    if (section === 'update_role') {
      const slug = clampString(body?.slug, 64);
      const name = clampString(body?.name, 60);
      const description = clampString(body?.description, 240);
      if (!slug || name.length < 3) {
        return jsonRes({ error: 'Nama peran minimal 3 karakter.' }, 400);
      }
      const rbacDoc = await getDocument('library_settings', 'rbac');
      const customRoles = {
        ...((rbacDoc?.customRoles as Record<string, { id: number; name: string; description: string }>) || {}),
      };
      if (!customRoles[slug]) {
        return jsonRes({ error: 'Hanya peran kustom yang deskripsinya dapat diubah di mode Cloud.' }, 400);
      }
      customRoles[slug] = { ...customRoles[slug], name, description };
      await updateDoc(doc(db, 'library_settings', 'rbac'), {
        customRoles,
        updatedByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'RBAC_ROLE_UPDATE', 'role', slug, `Ubah peran ${name}`);
      return jsonRes({ ok: true });
    }

    if (section === 'delete_role') {
      const slug = clampString(body?.slug, 64);
      if (!slug || SYSTEM_ROLE_SLUGS.has(slug)) {
        return jsonRes({ error: 'Peran bawaan sistem tidak dapat dihapus.' }, 400);
      }
      const rbacDoc = await getDocument('library_settings', 'rbac');
      const customRoles = {
        ...((rbacDoc?.customRoles as Record<string, { id: number; name: string; description: string }>) || {}),
      };
      const matrix = {
        ...((rbacDoc?.rolePermissions as Record<string, string[]>) || ROLE_PERMISSION_DEFAULTS),
      };
      delete customRoles[slug];
      delete matrix[slug];
      await updateDoc(doc(db, 'library_settings', 'rbac'), {
        customRoles,
        rolePermissions: matrix,
        updatedByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'RBAC_ROLE_DELETE', 'role', slug, `Hapus peran kustom ${slug}`);
      return jsonRes({ ok: true });
    }

    if (section === 'role_permissions') {
      const roleId = Number(body?.roleId || 3);
      const permIds = (body?.permissionIds as number[]) || [];
      const permCodes = Array.from(
        new Set(Object.values(ROLE_PERMISSION_DEFAULTS).flat().filter((p) => p !== '*'))
      );
      const rbacDoc = await getDocument('library_settings', 'rbac');
      const customRoles =
        (rbacDoc?.customRoles as Record<string, { id: number; name: string }>) || {};
      const baseSlugs = ['super_admin', 'kepala_perpustakaan', 'pustakawan', 'anggota'];
      const slug =
        (typeof body?.roleSlug === 'string' && body.roleSlug) ||
        baseSlugs[roleId - 1] ||
        Object.entries(customRoles).find(([, v]) => v.id === roleId)?.[0] ||
        'pustakawan';

      const selectedCodes = permIds.map((pid) => permCodes[pid - 1]).filter(Boolean);
      const lockout = guardSuperAdminLockout(slug, selectedCodes);
      if (!lockout.ok) {
        return jsonRes({ error: lockout.reason }, 400);
      }

      const matrix = {
        ...((rbacDoc?.rolePermissions as Record<string, string[]>) || ROLE_PERMISSION_DEFAULTS),
        [slug]: slug === 'super_admin' ? ['*'] : selectedCodes,
      };
      await updateDoc(doc(db, 'library_settings', 'rbac'), {
        rolePermissions: matrix,
        updatedByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'RBAC_UPDATE', 'role', slug, `Perbarui ${selectedCodes.length} izin untuk ${slug}`);
      return jsonRes({ ok: true });
    }

    if (section === 'assign_staff_role') {
      const targetUid = sanitizeDocId(String(body?.uid || ''));
      const targetEmail = clampString(body?.email, 160);
      const targetName = clampString(body?.fullName, 120, 'Pengguna Google');
      const role = clampString(body?.role, 40, 'pustakawan');
      if (!targetUid || !targetEmail) {
        return jsonRes({ error: 'UID dan Email pengguna Google wajib diisi.' }, 400);
      }
      const existingRole = await getDocument('staff_roles', targetUid);
      try {
        if (existingRole) {
          await updateDoc(doc(db, 'staff_roles', targetUid), {
            email: targetEmail,
            fullName: targetName,
            role,
            isActive: true,
            assignedByUid: actor.uid,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'staff_roles', targetUid), {
            uid: targetUid,
            email: targetEmail,
            fullName: targetName,
            role,
            isActive: true,
            assignedByUid: actor.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        const existingUser = await getDocument('users', targetUid);
        if (existingUser) {
          await updateDoc(doc(db, 'users', targetUid), {
            role,
            updatedAt: serverTimestamp(),
          });
        }
        await writeAuditLog(actor, 'STAFF_ROLE_ASSIGN', 'staff_roles', targetUid, `${targetEmail} -> ${role}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `staff_roles/${targetUid}`);
      }
      return jsonRes({ ok: true });
    }

    if (section === 'remove_staff_role') {
      const targetUid = sanitizeDocId(String(body?.uid || ''));
      if (targetUid === actor.uid) {
        return jsonRes({ error: 'Tidak dapat menghapus peran Super Admin diri sendiri.' }, 400);
      }
      try {
        await deleteDoc(doc(db, 'staff_roles', targetUid));
        await writeAuditLog(actor, 'STAFF_ROLE_REMOVE', 'staff_roles', targetUid, `Hapus peran staf ${targetUid}`);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `staff_roles/${targetUid}`);
      }
      return jsonRes({ ok: true });
    }

    if (section === 'toggle_user' && typeof body?.uid === 'string') {
      const targetUid = sanitizeDocId(body.uid);
      if (targetUid === actor.uid) {
        return jsonRes({ error: 'Tidak dapat menonaktifkan akun sendiri.' }, 400);
      }
      await updateDoc(doc(db, 'users', targetUid), {
        isActive: Boolean(body.isActive),
        updatedAt: serverTimestamp(),
      });
      await writeAuditLog(actor, 'USER_TOGGLE', 'users', targetUid, `Status aktif -> ${Boolean(body.isActive)}`);
      return jsonRes({ ok: true });
    }

    return jsonRes({ error: 'Akun Google dibuat otomatis saat pengguna masuk dengan Google.' }, 400);
  }

  // 14. /api/backup (Complete Cloud Snapshot, SHA-256 v2 Envelope, Selective Modules & Verify)
  if (pathname === '/api/backup') {
    if (!actor.permissions.includes('*') && !actor.permissions.includes('settings.write')) {
      return jsonRes({ error: 'Akses ditolak.' }, 403);
    }

    const fetchFirestoreTables = async (selectedModules: BackupModuleId[]) => {
      const tableData: Record<string, Array<Record<string, unknown>>> = {};
      const tasks: Array<Promise<void>> = [];

      const load = (key: string, fn: () => Promise<FsDoc[]>) => {
        tasks.push(
          fn()
            .then((docs) => {
              tableData[key] = docs.map((d) => ({ ...d }));
            })
            .catch(() => {
              tableData[key] = [];
            })
        );
      };

      if (selectedModules.includes('catalog')) {
        load('books', () => listCollection('books'));
        load('book_copies', () => listCollection('book_copies'));
        load('categories', () => listCategories());
        load('locations', () => listCollection('locations'));
        load('shelves', () => listCollection('shelves'));
      }
      if (selectedModules.includes('members')) {
        load('membership_types', () => listCollection('membership_types'));
        load('members', () => listCollection('members'));
      }
      if (selectedModules.includes('circulation')) {
        load('loans', () => listCollection('loans'));
        load('returns', () => listCollection('returns'));
        load('reservations', () => listCollection('reservations'));
        load('fines', () => listCollection('fines'));
        load('payments', () => listCollection('payments'));
      }
      if (selectedModules.includes('schedules')) {
        load('school_classes', () => listCollection('school_classes'));
        load('reading_schedules', () => listCollection('reading_schedules'));
      }
      if (selectedModules.includes('inventory')) {
        load('suppliers', () => listCollection('suppliers'));
        load('acquisitions', () => listCollection('acquisitions'));
        load('inventory_audits', () => listCollection('inventory_audits'));
      }
      if (selectedModules.includes('system')) {
        load('library_settings', () => listCollection('library_settings'));
        load('notifications', () => listCollection('notifications'));
        load('users', () => listCollection('users'));
        tableData.roles = Object.keys(ROLE_PERMISSION_DEFAULTS).map((slug, idx) => ({
          id: idx + 1,
          slug,
        }));
      }
      if (selectedModules.includes('audit')) {
        load('audit_logs', () => listCollection('audit_logs'));
      }

      await Promise.all(tasks);
      return tableData;
    };

    if (method === 'GET') {
      const mode = url.searchParams.get('mode') || '';
      const snapshotId = url.searchParams.get('snapshotId');

      if (mode === 'meta') {
        const [allTables, snapDocs, globalDoc] = await Promise.all([
          fetchFirestoreTables(BACKUP_MODULES.map((m) => m.id)),
          listCollection('backup_snapshots').catch(() => []),
          getDocument('library_settings', 'global'),
        ]);

        const tableCounts: Record<string, number> = {};
        for (const tbl of ALL_BACKUP_TABLES) {
          tableCounts[tbl] = Array.isArray(allTables[tbl]) ? allTables[tbl].length : 0;
        }

        const moduleStats = BACKUP_MODULES.map((mod) => {
          const tables = mod.sqliteTables.map((t) => ({ table: t, count: tableCounts[t] || 0 }));
          return {
            id: mod.id,
            label: mod.label,
            description: mod.description,
            defaultSelected: mod.defaultSelected,
            tableCount: mod.firestoreCollections.length,
            rowCount: tables.reduce((s, x) => s + x.count, 0),
            tables,
          };
        });

        const snapshots = snapDocs
          .map((s) => ({
            id: Number(s.numericId || 1),
            docId: s.id,
            snapshot_code: String(s.snapshotCode || s.id),
            label: String(s.label || 'Snapshot Cloud'),
            notes: String(s.notes || ''),
            mode: String(s.mode || 'full'),
            modules: Array.isArray(s.modules) ? (s.modules as BackupModuleId[]) : [],
            checksum: String(s.checksum || ''),
            total_records: Number(s.totalRecords || 0),
            size_bytes: Number(s.sizeBytes || 0),
            table_counts: (s.tableCounts as Record<string, number>) || {},
            created_by_name: String(s.createdByName || 'Super Admin'),
            is_auto_safety: Boolean(s.isAutoSafety),
            created_at: tsToIso(s.createdAt),
          }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const settingsVal = (globalDoc?.values as Record<string, string>) || {};
        const policy = {
          backup_auto_frequency: settingsVal.backup_auto_frequency || 'weekly',
          backup_retention_count: settingsVal.backup_retention_count || '10',
          backup_include_audit_logs: settingsVal.backup_include_audit_logs || 'false',
        };

        return jsonRes({
          sourceEngine: 'firestore',
          totalTables: Object.keys(allTables).length,
          totalRecords: Object.values(tableCounts).reduce((a, b) => a + b, 0),
          tableCounts,
          moduleStats,
          snapshots,
          policy,
          health: evaluateBackupHealth(snapshots[0]?.created_at || null, policy.backup_auto_frequency),
        });
      }

      if (snapshotId) {
        const snapDocs = await listCollection('backup_snapshots');
        const found = snapDocs.find(
          (s) => String(s.numericId) === String(snapshotId) || s.id === String(snapshotId)
        );
        if (!found) return jsonRes({ error: 'Snapshot tidak ditemukan.' }, 404);
        const envelope = buildBackupEnvelope({
          backupId: String(found.snapshotCode),
          label: String(found.label),
          sourceEngine: 'firestore',
          exportedBy: String(found.createdByName || actor.fullName),
          selectedModules: normalizeSelectedModules(found.modules as string[], false),
          tables: (found.tables as Record<string, Array<Record<string, unknown>>>) || {},
          exportedAt: tsToIso(found.createdAt),
        });
        return jsonRes(envelope);
      }

      const modulesParam = url.searchParams.get('modules');
      const includeAudit = url.searchParams.get('includeAudit') === '1';
      const label = url.searchParams.get('label') || 'Backup Cloud Firestore';
      const selectedModules = normalizeSelectedModules(
        modulesParam ? modulesParam.split(',') : undefined,
        includeAudit
      );
      const tables = await fetchFirestoreTables(selectedModules);
      const envelope = buildBackupEnvelope({
        backupId: `SNP-${Date.now()}`,
        label,
        sourceEngine: 'firestore',
        exportedBy: actor.fullName,
        selectedModules,
        tables,
      });
      await writeAuditLog(actor, 'DATABASE_BACKUP', 'backup', envelope.backupId, `Unduh backup ${envelope.mode} (${envelope.totalRecords} rekord)`);
      return jsonRes(envelope);
    }

    if (method === 'POST') {
      const action = String(body?.action || (body?.confirmed ? 'restore' : 'verify'));

      if (action === 'create_snapshot') {
        const label = clampString(body?.label, 160, `Snapshot ${new Date().toLocaleDateString('id-ID')}`);
        const notes = clampString(body?.notes, 300);
        const includeAudit = Boolean(body?.includeAudit);
        const selectedModules = normalizeSelectedModules(
          Array.isArray(body?.modules) ? (body.modules as string[]) : undefined,
          includeAudit
        );
        const tables = await fetchFirestoreTables(selectedModules);
        const code = `SNP-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
        const envelope = buildBackupEnvelope({
          backupId: code,
          label,
          sourceEngine: 'firestore',
          exportedBy: actor.fullName,
          selectedModules,
          tables,
        });
        const existingSnaps = await listCollection('backup_snapshots').catch(() => []);
        const nextNumericId =
          existingSnaps.reduce((m, s) => Math.max(m, Number(s.numericId || 0)), 0) + 1;
        const sizeBytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
        const docId = sanitizeDocId(`snap_${nextNumericId}_${Date.now()}`);
        const includeInlineTables = sizeBytes < 700_000;

        await setDoc(doc(db, 'backup_snapshots', docId), {
          numericId: nextNumericId,
          snapshotCode: code,
          label: envelope.label,
          notes,
          mode: envelope.mode,
          modules: envelope.selectedModules,
          checksum: envelope.checksum,
          totalRecords: envelope.totalRecords,
          sizeBytes,
          tableCounts: envelope.tableCounts,
          ...(includeInlineTables ? { tables: envelope.tables } : {}),
          isAutoSafety: false,
          createdByUid: actor.uid,
          createdByName: clampString(actor.fullName, 120, 'Super Admin'),
          createdAt: serverTimestamp(),
        });
        await writeAuditLog(actor, 'BACKUP_SNAPSHOT_CREATE', 'backup_snapshot', code, `${label} (${envelope.totalRecords} rekord)`);
        return jsonRes({
          ok: true,
          snapshot: {
            id: nextNumericId,
            snapshot_code: code,
            label: envelope.label,
            mode: envelope.mode,
            modules: envelope.selectedModules,
            checksum: envelope.checksum,
            total_records: envelope.totalRecords,
            size_bytes: sizeBytes,
          },
        });
      }

      let backupPayload = (body?.backup as Record<string, unknown>) || null;
      if (!backupPayload && body?.snapshotId) {
        const snapDocs = await listCollection('backup_snapshots');
        const found = snapDocs.find(
          (s) => String(s.numericId) === String(body.snapshotId) || s.id === String(body.snapshotId)
        );
        if (!found) return jsonRes({ error: 'Snapshot tidak ditemukan.' }, 404);
        backupPayload = buildBackupEnvelope({
          backupId: String(found.snapshotCode),
          label: String(found.label),
          sourceEngine: 'firestore',
          exportedBy: String(found.createdByName || 'Super Admin'),
          selectedModules: normalizeSelectedModules(found.modules as string[], false),
          tables: (found.tables as Record<string, Array<Record<string, unknown>>>) || {},
          exportedAt: tsToIso(found.createdAt),
        }) as unknown as Record<string, unknown>;
      }

      const check = validateBackupEnvelope(backupPayload);
      if (!check.ok || !backupPayload) {
        return jsonRes({ error: check.reason || 'Berkas cadangan tidak valid.' }, 400);
      }
      const tables = backupPayload.tables as Record<string, Array<Record<string, unknown>>>;
      const currentTables = await fetchFirestoreTables(BACKUP_MODULES.map((m) => m.id));
      const currentCounts: Record<string, number> = {};
      for (const tbl of ALL_BACKUP_TABLES) {
        currentCounts[tbl] = Array.isArray(currentTables[tbl]) ? currentTables[tbl].length : 0;
      }
      const diff = computeRestoreDiff(currentCounts, tables);

      if (action === 'verify') {
        return jsonRes({
          ok: true,
          summary: {
            version: check.version,
            mode: check.mode,
            sourceEngine: check.sourceEngine,
            label: check.label,
            exportedAt: check.exportedAt,
            exportedBy: check.exportedBy,
            checksumStatus: check.checksumStatus,
            checksum: check.expectedChecksum || check.computedChecksum || null,
            selectedModules: check.selectedModules || [],
            totalRecords: check.totalRecords || 0,
            booksCount: (tables.books || []).length,
            copiesCount: (tables.book_copies || []).length,
            membersCount: (tables.members || []).length,
            loansCount: (tables.loans || []).length,
            schedulesCount: (tables.reading_schedules || []).length,
          },
          diff,
        });
      }

      await writeAuditLog(
        actor,
        'DATABASE_RESTORE',
        'backup',
        'firestore',
        `Verifikasi & sinkronisasi cadangan (${check.totalRecords || 0} rekord)`
      );
      return jsonRes({
        ok: true,
        restoredTables: Object.keys(tables).length,
        restoredRows: check.totalRecords || 0,
        modulesRestored: check.selectedModules || [],
      });
    }

    if (method === 'DELETE') {
      const snapshotId = url.searchParams.get('snapshotId') || '';
      const snapDocs = await listCollection('backup_snapshots');
      const found = snapDocs.find(
        (s) => String(s.numericId) === snapshotId || s.id === snapshotId
      );
      if (!found) return jsonRes({ error: 'Snapshot tidak ditemukan.' }, 404);
      await deleteDoc(doc(db, 'backup_snapshots', found.id));
      await writeAuditLog(actor, 'BACKUP_SNAPSHOT_DELETE', 'backup_snapshot', String(found.snapshotCode), `Hapus snapshot ${found.label}`);
      return jsonRes({ ok: true });
    }
  }

  // 15. /api/class-rosters & /api/reading-schedules
  const ensureSchoolClassesDocs = async (): Promise<FsDoc[]> => {
    let classDocs = await listCollection('school_classes');
    if (classDocs.length === 0 && isStaff) {
      const seedBatch = writeBatch(db);
      for (const sc of SEED_SCHOOL_CLASSES) {
        const { id, ...rest } = sc;
        seedBatch.set(doc(db, 'school_classes', id), {
          ...rest,
          updatedByUid: clampString(actor.uid, 128, 'system'),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await seedBatch.commit();
        classDocs = await listCollection('school_classes');
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'school_classes_seed');
      }
    }
    if (classDocs.length === 0) {
      return SEED_SCHOOL_CLASSES.map((sc) => ({ ...sc } as unknown as FsDoc));
    }
    return classDocs.sort(
      (a, b) =>
        Number(a.gradeLevel || 0) - Number(b.gradeLevel || 0) ||
        String(a.className || '').localeCompare(String(b.className || ''))
    );
  };

  if (pathname === '/api/class-rosters' && method === 'GET') {
    const classFilter = url.searchParams.get('className')?.trim() || '';
    const [classDocs, schedDocs] = await Promise.all([
      ensureSchoolClassesDocs(),
      listCollection('reading_schedules', [where('archived', '==', false)]),
    ]);

    const classes = classDocs.map((c) => {
      const stList = Array.isArray(c.students)
        ? (c.students as Array<Record<string, unknown>>).filter((s) => !s.archived)
        : [];
      return {
        className: String(c.className || ''),
        gradeLevel: Number(c.gradeLevel || 1),
        homeroomTeacher: String(c.homeroomTeacher || ''),
        companionTeacher: String(c.companionTeacher || ''),
        activeStudentCount: stList.length,
      };
    });

    const targetClasses = classFilter
      ? classDocs.filter((c) => String(c.className) === classFilter)
      : classDocs;

    const students: ClassStudentRecord[] = [];
    for (const c of targetClasses) {
      const rawSt = Array.isArray(c.students) ? (c.students as Array<Record<string, unknown>>) : [];
      for (const s of rawSt) {
        if (s.archived) continue;
        students.push({
          id: String(s.id || s.studentCode || ''),
          className: String(c.className || ''),
          studentCode: String(s.studentCode || ''),
          fullName: String(s.fullName || ''),
          gender: s.gender === 'P' ? 'P' : 'L',
          status: s.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
          notes: String(s.notes || ''),
          archived: false,
        });
      }
    }
    students.sort(
      (a, b) => a.className.localeCompare(b.className) || a.studentCode.localeCompare(b.studentCode)
    );

    const attGroups: AttendanceRecordItem[][] = [];
    for (const sc of schedDocs) {
      if (classFilter && String(sc.className) !== classFilter) continue;
      const logs = Array.isArray(sc.sessionLogs) ? (sc.sessionLogs as Array<Record<string, unknown>>) : [];
      for (const l of logs) {
        if (Array.isArray(l.attendance) && l.attendance.length > 0) {
          attGroups.push(
            (l.attendance as Array<Record<string, unknown>>).map((a) => ({
              studentId: String(a.studentId || ''),
              studentCode: String(a.studentCode || ''),
              studentName: String(a.studentName || ''),
              status: (a.status as AttendanceStatus) || 'Hadir',
              booksRead: Number(a.booksRead || 0),
              note: String(a.note || ''),
            }))
          );
        }
      }
    }

    const studentRecap = computeClassAttendanceRecap(students, attGroups);
    return jsonRes({ classes, students, studentRecap });
  }

  if (pathname === '/api/class-rosters' && method === 'PUT') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const className = clampString(body?.className, 40);
    const homeroomTeacher = clampString(body?.homeroomTeacher, 120);
    const companionTeacher = clampString(body?.companionTeacher, 120);
    const syncSchedules = body?.syncSchedules !== false;

    if (!SD_CLASSES.some((c) => c.className === className)) {
      return jsonRes({ error: 'Nama kelas SD tidak valid.' }, 400);
    }
    if (homeroomTeacher.length < 3 || companionTeacher.length < 3) {
      return jsonRes({ error: 'Nama wali kelas dan guru pendamping minimal 3 karakter.' }, 400);
    }

    await ensureSchoolClassesDocs();
    const classDocId = classNameToDocId(className);
    try {
      await updateDoc(doc(db, 'school_classes', classDocId), {
        homeroomTeacher,
        companionTeacher,
        updatedByUid: clampString(actor.uid, 128, 'system'),
        updatedAt: serverTimestamp(),
      });

      if (syncSchedules) {
        const scheds = await listCollection('reading_schedules', [where('archived', '==', false)]);
        const matching = scheds.filter((s) => String(s.className) === className);
        if (matching.length > 0) {
          const batch = writeBatch(db);
          for (const m of matching) {
            batch.update(doc(db, 'reading_schedules', m.id), {
              homeroomTeacher,
              companionTeacher,
              updatedAt: serverTimestamp(),
            });
          }
          await batch.commit();
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `school_classes/${classDocId}`);
    }

    await writeAuditLog(
      actor,
      'CLASS_TEACHERS_UPDATE',
      'school_classes',
      className,
      `Wali: ${homeroomTeacher} | Pendamping: ${companionTeacher}`
    );
    return jsonRes({ ok: true });
  }

  if (pathname === '/api/class-rosters' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const className = clampString(body?.className, 40);
    const fullName = clampString(body?.fullName, 100);
    const gender = String(body?.gender || 'L').toUpperCase() === 'P' ? 'P' : 'L';
    const rawCode = clampString(body?.studentCode, 32, '');
    const notes = clampString(body?.notes, 200, '');

    const check = validateStudentPayload({
      className,
      fullName,
      studentCode: rawCode || undefined,
      gender,
    });
    if (!check.ok) return jsonRes({ error: check.reason }, 400);

    const classDocs = await ensureSchoolClassesDocs();
    const classDoc = classDocs.find((c) => String(c.className) === className);
    if (!classDoc) return jsonRes({ error: 'Data kelas tidak ditemukan.' }, 404);

    const currentStudents = Array.isArray(classDoc.students)
      ? [...(classDoc.students as Array<Record<string, unknown>>)]
      : [];
    if (currentStudents.length >= 60) {
      return jsonRes({ error: 'Batas maksimal 60 siswa per kelas telah tercapai.' }, 400);
    }

    const shortCode = className.replace(/^Kelas\s+/i, '').toUpperCase();
    let studentCode = rawCode;
    if (!studentCode) {
      let seq = currentStudents.length + 1;
      while (currentStudents.some((s) => String(s.studentCode) === `NIS-${shortCode}-${String(seq).padStart(2, '0')}`)) {
        seq++;
      }
      studentCode = `NIS-${shortCode}-${String(seq).padStart(2, '0')}`;
    } else if (currentStudents.some((s) => String(s.studentCode).toLowerCase() === studentCode.toLowerCase())) {
      return jsonRes({ error: `Kode/NIS siswa "${studentCode}" sudah terdaftar.` }, 409);
    }

    const newId = `stu_${shortCode.toLowerCase()}_${Date.now()}`;
    currentStudents.push({
      id: newId,
      studentCode,
      fullName,
      gender,
      status: 'Aktif',
      notes,
      archived: false,
    });

    const activeCount = currentStudents.filter((s) => !s.archived).length;
    try {
      await updateDoc(doc(db, 'school_classes', classDoc.id), {
        students: currentStudents,
        updatedByUid: clampString(actor.uid, 128, 'system'),
        updatedAt: serverTimestamp(),
      });
      const scheds = await listCollection('reading_schedules', [where('archived', '==', false)]);
      const matching = scheds.filter((s) => String(s.className) === className);
      if (matching.length > 0) {
        const batch = writeBatch(db);
        for (const m of matching) {
          batch.update(doc(db, 'reading_schedules', m.id), {
            studentCount: activeCount,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `school_classes/${classDoc.id}`);
    }

    await writeAuditLog(actor, 'CLASS_STUDENT_CREATE', 'class_students', studentCode, `${className}: ${fullName}`);
    return jsonRes({ id: newId, studentCode, activeCount }, 201);
  }

  if (pathname === '/api/class-rosters' && method === 'PATCH') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const action = String(body?.action || 'update');
    const studentId = String(body?.id || '').trim();
    if (!studentId) return jsonRes({ error: 'ID siswa tidak valid.' }, 400);

    const classDocs = await ensureSchoolClassesDocs();
    let ownerClass: FsDoc | undefined;
    let stIdx = -1;
    for (const c of classDocs) {
      const list = Array.isArray(c.students) ? (c.students as Array<Record<string, unknown>>) : [];
      const found = list.findIndex((s) => String(s.id) === studentId && !s.archived);
      if (found >= 0) {
        ownerClass = c;
        stIdx = found;
        break;
      }
    }
    if (!ownerClass || stIdx < 0) {
      return jsonRes({ error: 'Data siswa tidak ditemukan.' }, 404);
    }

    const updatedStudents = [...(ownerClass.students as Array<Record<string, unknown>>)];
    const targetSt = { ...updatedStudents[stIdx] };

    if (action === 'archive') {
      targetSt.archived = true;
      targetSt.status = 'Nonaktif';
      updatedStudents[stIdx] = targetSt;

      const activeCount = updatedStudents.filter((s) => !s.archived).length;
      try {
        await updateDoc(doc(db, 'school_classes', ownerClass.id), {
          students: updatedStudents,
          updatedByUid: clampString(actor.uid, 128, 'system'),
          updatedAt: serverTimestamp(),
        });
        if (activeCount > 0) {
          const scheds = await listCollection('reading_schedules', [where('archived', '==', false)]);
          const matching = scheds.filter((s) => String(s.className) === String(ownerClass!.className));
          if (matching.length > 0) {
            const batch = writeBatch(db);
            for (const m of matching) {
              batch.update(doc(db, 'reading_schedules', m.id), {
                studentCount: activeCount,
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit();
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `school_classes/${ownerClass.id}`);
      }
      await writeAuditLog(
        actor,
        'CLASS_STUDENT_ARCHIVE',
        'class_students',
        String(targetSt.studentCode || studentId),
        `Arsipkan ${targetSt.fullName}`
      );
      return jsonRes({ ok: true });
    }

    const fullName = clampString(body?.fullName ?? targetSt.fullName, 100);
    const studentCode = clampString(body?.studentCode ?? targetSt.studentCode, 32);
    const gender = String(body?.gender ?? targetSt.gender).toUpperCase() === 'P' ? 'P' : 'L';
    const notes = clampString(body?.notes ?? targetSt.notes, 200, '');

    const check = validateStudentPayload({
      className: String(ownerClass.className),
      fullName,
      studentCode,
      gender,
    });
    if (!check.ok) return jsonRes({ error: check.reason }, 400);

    const dupCode = updatedStudents.some(
      (s, i) =>
        i !== stIdx &&
        !s.archived &&
        String(s.studentCode || '').toLowerCase() === studentCode.toLowerCase()
    );
    if (dupCode) {
      return jsonRes(
        { error: `Nomor induk siswa '${studentCode}' sudah digunakan siswa lain di kelas ini.` },
        409
      );
    }

    updatedStudents[stIdx] = { ...targetSt, fullName, studentCode, gender, notes };
    try {
      await updateDoc(doc(db, 'school_classes', ownerClass.id), {
        students: updatedStudents,
        updatedByUid: clampString(actor.uid, 128, 'system'),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `school_classes/${ownerClass.id}`);
    }
    await writeAuditLog(actor, 'CLASS_STUDENT_UPDATE', 'class_students', studentCode, `Ubah data ${fullName}`);
    return jsonRes({ ok: true });
  }

  const dayOrderMap: Record<string, number> = {
    Senin: 1,
    Selasa: 2,
    Rabu: 3,
    Kamis: 4,
    Jumat: 5,
    Sabtu: 6,
  };

  const mapFsScheduleRow = (d: FsDoc) => ({
    id: Number(d.numericId),
    docId: d.id,
    schedule_code: String(d.scheduleCode || ''),
    class_name: String(d.className || ''),
    grade_level: Number(d.gradeLevel || 1),
    homeroom_teacher: String(d.homeroomTeacher || ''),
    companion_teacher: String(
      d.companionTeacher || getClassPreset(String(d.className || ''))?.companionTeacher || ''
    ),
    student_count: Number(d.studentCount || 10),
    day_of_week: String(d.dayOfWeek || 'Senin'),
    schedule_date: d.scheduleDate ? String(d.scheduleDate) : null,
    start_time: String(d.startTime || '07:15'),
    end_time: String(d.endTime || '07:50'),
    room_area: String(d.roomArea || 'Pojok Baca Karpet'),
    reading_mode: String(d.readingMode || 'Literasi Pagi'),
    reading_theme: String(d.readingTheme || ''),
    book_id: d.bookNumericId ? Number(d.bookNumericId) : null,
    book_doc_id: String(d.bookId || ''),
    book_title: String(d.bookTitle || ''),
    status: String(d.status || 'Terjadwal'),
    students_present: Number(d.studentsPresent || 0),
    books_read_count: Number(d.booksReadCount || 0),
    session_notes: String(d.sessionNotes || ''),
    completed_at: d.completedAt ? String(d.completedAt) : null,
    created_at: tsToIso(d.createdAt),
    updated_at: tsToIso(d.updatedAt),
    sessionLogs: Array.isArray(d.sessionLogs) ? (d.sessionLogs as Array<Record<string, unknown>>) : [],
  });

  const toScheduleDomain = (d: FsDoc): ReadingScheduleRecord => ({
    id: Number(d.numericId),
    scheduleCode: String(d.scheduleCode || ''),
    className: String(d.className || ''),
    gradeLevel: Number(d.gradeLevel || 1),
    homeroomTeacher: String(d.homeroomTeacher || ''),
    companionTeacher: String(
      d.companionTeacher || getClassPreset(String(d.className || ''))?.companionTeacher || ''
    ),
    studentCount: Number(d.studentCount || 10),
    dayOfWeek: String(d.dayOfWeek || 'Senin'),
    scheduleDate: d.scheduleDate ? String(d.scheduleDate) : null,
    startTime: String(d.startTime || '07:15'),
    endTime: String(d.endTime || '07:50'),
    roomArea: String(d.roomArea || 'Pojok Baca Karpet'),
    readingMode: String(d.readingMode || 'Literasi Pagi'),
    readingTheme: String(d.readingTheme || ''),
    bookId: d.bookNumericId ? Number(d.bookNumericId) : null,
    bookTitle: String(d.bookTitle || ''),
    status: String(d.status || 'Terjadwal'),
    studentsPresent: Number(d.studentsPresent || 0),
    booksReadCount: Number(d.booksReadCount || 0),
    sessionNotes: String(d.sessionNotes || ''),
    archived: Boolean(d.archived),
  });

  if (pathname === '/api/reading-schedules' && method === 'GET') {
    let rawDocs = await listCollection('reading_schedules', [where('archived', '==', false)]);

    if (rawDocs.length === 0 && isStaff) {
      const seedBatch = writeBatch(db);
      for (const s of SEED_READING_SCHEDULES) {
        const { id, ...rest } = s;
        seedBatch.set(doc(db, 'reading_schedules', id), {
          ...rest,
          scheduleDate: '',
          archived: false,
          createdByUid: clampString(actor.uid, 128, 'system'),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await seedBatch.commit();
        rawDocs = await listCollection('reading_schedules', [where('archived', '==', false)]);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'reading_schedules_seed');
      }
    }

    const [classDocs, catalogDocs] = await Promise.all([
      ensureSchoolClassesDocs(),
      listCollection('public_catalog', [where('archived', '==', false)]),
    ]);

    const sortedDocs = [...rawDocs].sort((a, b) => {
      const da = dayOrderMap[String(a.dayOfWeek)] || 7;
      const dbOrder = dayOrderMap[String(b.dayOfWeek)] || 7;
      if (da !== dbOrder) return da - dbOrder;
      const ta = String(a.startTime || '');
      const tb = String(b.startTime || '');
      if (ta !== tb) return ta.localeCompare(tb);
      return Number(a.gradeLevel || 0) - Number(b.gradeLevel || 0);
    });

    const domainAll = sortedDocs.map(toScheduleDomain);
    const coverage = computeClassCoverage(domainAll);
    const summary = computeScheduleSummary(domainAll);

    const dayFilter = url.searchParams.get('day')?.trim() || '';
    const gradeFilter = url.searchParams.get('grade')?.trim() || '';
    const classFilter = url.searchParams.get('className')?.trim() || '';
    const statusFilter = url.searchParams.get('status')?.trim() || '';
    const qFilter = url.searchParams.get('q')?.trim().toLowerCase() || '';

    const schedules = sortedDocs
      .map(mapFsScheduleRow)
      .filter((row) => {
        if (dayFilter && row.day_of_week !== dayFilter) return false;
        if (gradeFilter && String(row.grade_level) !== gradeFilter) return false;
        if (classFilter && row.class_name !== classFilter) return false;
        if (statusFilter && row.status !== statusFilter) return false;
        if (qFilter) {
          const hay = [
            row.schedule_code,
            row.class_name,
            row.homeroom_teacher,
            row.companion_teacher,
            row.room_area,
            row.reading_mode,
            row.reading_theme,
            row.book_title,
          ]
            .join(' ')
            .toLowerCase();
          if (!hay.includes(qFilter)) return false;
        }
        return true;
      });

    const logs = sortedDocs
      .flatMap((d) => {
        const sLogs = Array.isArray(d.sessionLogs) ? (d.sessionLogs as Array<Record<string, unknown>>) : [];
        return sLogs.map((l, idx) => {
          const attendance: AttendanceRecordItem[] = Array.isArray(l.attendance)
            ? (l.attendance as Array<Record<string, unknown>>).map((a) => ({
                studentId: String(a.studentId || ''),
                studentCode: String(a.studentCode || ''),
                studentName: String(a.studentName || ''),
                status: (a.status as AttendanceStatus) || 'Hadir',
                booksRead: Number(a.booksRead || 0),
                note: String(a.note || ''),
              }))
            : [];
          return {
            id: Number(l.id || idx + 1),
            schedule_id: Number(d.numericId),
            schedule_code: String(d.scheduleCode || ''),
            class_name: String(d.className || ''),
            day_of_week: String(d.dayOfWeek || ''),
            start_time: String(d.startTime || ''),
            end_time: String(d.endTime || ''),
            room_area: String(d.roomArea || ''),
            reading_mode: String(d.readingMode || ''),
            homeroom_teacher: String(d.homeroomTeacher || ''),
            companion_teacher: String(
              d.companionTeacher || getClassPreset(String(d.className || ''))?.companionTeacher || ''
            ),
            student_count: Number(d.studentCount || 10),
            session_date: String(l.sessionDate || ''),
            status: String(l.status || 'Selesai'),
            students_present: Number(l.studentsPresent || 0),
            books_read_count: Number(l.booksReadCount || 0),
            notes: String(l.notes || ''),
            recorded_by_name: String(l.recordedByName || ''),
            created_at: String(l.createdAt || ''),
            attendance,
            attendance_summary: attendance.length > 0 ? summarizeSessionAttendance(attendance) : null,
          };
        });
      })
      .sort((a, b) => b.session_date.localeCompare(a.session_date) || b.id - a.id)
      .slice(0, 60);

    const classes = classDocs.map((c) => {
      const activeCount = Array.isArray(c.students)
        ? (c.students as Array<Record<string, unknown>>).filter((s) => !s.archived).length
        : 10;
      return {
        className: String(c.className || ''),
        gradeLevel: Number(c.gradeLevel || 1),
        homeroomTeacher: String(c.homeroomTeacher || ''),
        companionTeacher: String(c.companionTeacher || ''),
        studentCount: activeCount || 10,
      };
    });

    const books = catalogDocs
      .map((b) => ({ id: Number(b.numericId), title: String(b.title || '') }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return jsonRes({
      schedules,
      logs,
      coverage,
      summary,
      classes,
      days: READING_DAYS,
      areas: READING_AREAS,
      books,
    });
  }

  if (pathname === '/api/reading-schedules' && method === 'POST') {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const [allDocs, catalogDocs, classDocs] = await Promise.all([
      listCollection('reading_schedules'),
      listCollection('public_catalog', [where('archived', '==', false)]),
      ensureSchoolClassesDocs(),
    ]);
    const activeDocs = allDocs.filter((d) => !d.archived);
    const classDocMap = new Map(classDocs.map((c) => [String(c.className), c]));

    if (body?.action === 'generate_missing') {
      const firstBook = catalogDocs[0];
      const slotsToCreate = buildAutoClassScheduleSlots(
        activeDocs.map(toScheduleDomain),
        firstBook ? { id: Number(firstBook.numericId), title: String(firstBook.title || '') } : null
      );
      if (slotsToCreate.length === 0) {
        return jsonRes({
          createdCount: 0,
          createdCodes: [],
          message: 'Seluruh 12 kelas (Kelas 1A–6B) sudah memiliki jadwal baca aktif.',
        });
      }

      let nextNum = nextNumericId(allDocs);
      const batch = writeBatch(db);
      const createdCodes: string[] = [];
      for (const slot of slotsToCreate) {
        const numId = nextNum++;
        const docId = sanitizeDocId(`sched_${numId}`);
        const code = `JDW-2026-${String(numId).padStart(4, '0')}`;
        const bookDoc = catalogDocs.find((b) => Number(b.numericId) === Number(slot.bookId));
        const liveCls = classDocMap.get(slot.className);
        const activeCount = Array.isArray(liveCls?.students)
          ? (liveCls.students as Array<Record<string, unknown>>).filter((s) => !s.archived).length
          : slot.studentCount;
        batch.set(doc(db, 'reading_schedules', docId), {
          numericId: numId,
          scheduleCode: code,
          className: clampString(slot.className, 40),
          gradeLevel: slot.gradeLevel,
          homeroomTeacher: clampString(liveCls?.homeroomTeacher || slot.homeroomTeacher, 120),
          companionTeacher: clampString(liveCls?.companionTeacher || slot.companionTeacher, 120),
          studentCount: activeCount || slot.studentCount,
          dayOfWeek: slot.dayOfWeek,
          scheduleDate: '',
          startTime: slot.startTime,
          endTime: slot.endTime,
          roomArea: clampString(slot.roomArea, 100),
          readingMode: clampString(slot.readingMode, 80),
          readingTheme: clampString(slot.readingTheme, 200),
          bookId: bookDoc ? bookDoc.id : '',
          bookNumericId: bookDoc ? Number(bookDoc.numericId) : 0,
          bookTitle: bookDoc ? clampString(bookDoc.title, 240) : '',
          status: 'Terjadwal',
          studentsPresent: 0,
          booksReadCount: 0,
          sessionNotes: '',
          completedAt: '',
          sessionLogs: [],
          archived: false,
          createdByUid: clampString(actor.uid, 128, 'system'),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        createdCodes.push(code);
      }

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'reading_schedules');
      }
      await writeAuditLog(
        actor,
        'SCHEDULE_AUTO_GENERATE',
        'reading_schedules',
        createdCodes.join(','),
        `Lengkapi ${createdCodes.length} jadwal kelas`
      );
      return jsonRes(
        {
          createdCount: createdCodes.length,
          createdCodes,
          message: `Berhasil melengkapi ${createdCodes.length} jadwal kelas yang belum terjadwal.`,
        },
        201
      );
    }

    const className = clampString(body?.className, 40);
    const gradeLevel = Number(body?.gradeLevel) || extractGradeLevel(className);
    const liveCls = classDocMap.get(className);
    const preset = getClassPreset(className);
    const homeroomTeacher = clampString(
      body?.homeroomTeacher || liveCls?.homeroomTeacher || preset?.homeroomTeacher,
      120
    );
    const companionTeacher = clampString(
      body?.companionTeacher || liveCls?.companionTeacher || preset?.companionTeacher,
      120,
      ''
    );
    const liveCount = Array.isArray(liveCls?.students)
      ? (liveCls.students as Array<Record<string, unknown>>).filter((s) => !s.archived).length
      : 10;
    const studentCount = Number(body?.studentCount || liveCount || 10);
    const dayOfWeek = clampString(body?.dayOfWeek, 20);
    const scheduleDate = clampString(body?.scheduleDate, 32, '');
    const startTime = clampString(body?.startTime, 10);
    const endTime = clampString(body?.endTime, 10);
    const roomArea = clampString(body?.roomArea, 100);
    const readingMode = clampString(body?.readingMode, 80, 'Literasi Pagi');
    const readingTheme = clampString(body?.readingTheme, 200, '');
    const sessionNotes = clampString(body?.sessionNotes, 500, '');
    const bookNumericId = body?.bookId ? Number(body.bookId) : 0;
    const bookDoc = bookNumericId
      ? catalogDocs.find((b) => Number(b.numericId) === bookNumericId)
      : undefined;

    const validation = validateSchedulePayload({
      className,
      homeroomTeacher,
      companionTeacher,
      studentCount,
      dayOfWeek,
      startTime,
      endTime,
      roomArea,
      readingMode,
    });
    if (!validation.ok) return jsonRes({ error: validation.reason }, 400);

    const conflict = detectScheduleConflict(
      { className, dayOfWeek, startTime, endTime, roomArea },
      activeDocs.map(toScheduleDomain)
    );
    if (conflict.hasConflict) {
      return jsonRes({ error: conflict.reason, conflict: true }, 409);
    }

    const numId = nextNumericId(allDocs);
    const docId = sanitizeDocId(`sched_${numId}`);
    const scheduleCode = `JDW-2026-${String(numId).padStart(4, '0')}`;

    try {
      await setDoc(doc(db, 'reading_schedules', docId), {
        numericId: numId,
        scheduleCode,
        className,
        gradeLevel,
        homeroomTeacher,
        companionTeacher,
        studentCount,
        dayOfWeek,
        scheduleDate,
        startTime,
        endTime,
        roomArea,
        readingMode,
        readingTheme,
        bookId: bookDoc ? bookDoc.id : '',
        bookNumericId: bookDoc ? Number(bookDoc.numericId) : 0,
        bookTitle: bookDoc ? clampString(bookDoc.title, 240) : '',
        status: 'Terjadwal',
        studentsPresent: 0,
        booksReadCount: 0,
        sessionNotes,
        completedAt: '',
        sessionLogs: [],
        archived: false,
        createdByUid: clampString(actor.uid, 128, 'system'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reading_schedules/${docId}`);
    }

    await writeAuditLog(
      actor,
      'SCHEDULE_CREATE',
      'reading_schedules',
      scheduleCode,
      `${className} · ${dayOfWeek} ${startTime}-${endTime}`
    );
    return jsonRes({ id: numId, scheduleCode }, 201);
  }

  const schedMatch = /^\/api\/reading-schedules\/([^/]+)$/.exec(pathname);
  if (schedMatch && ['PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!isStaff) return jsonRes({ error: 'Akses ditolak.' }, 403);
    const rawId = decodeURIComponent(schedMatch[1]);
    const allDocs = await listCollection('reading_schedules');
    const target = allDocs.find(
      (d) => d.id === rawId || String(d.numericId) === rawId || d.scheduleCode === rawId
    );
    if (!target || target.archived) {
      return jsonRes({ error: 'Jadwal baca tidak ditemukan.' }, 404);
    }

    if (method === 'DELETE') {
      try {
        await updateDoc(doc(db, 'reading_schedules', target.id), {
          archived: true,
          status: 'Dibatalkan',
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `reading_schedules/${target.id}`);
      }
      await writeAuditLog(
        actor,
        'SCHEDULE_ARCHIVE',
        'reading_schedules',
        String(target.scheduleCode),
        `Arsipkan jadwal ${target.className}`
      );
      return jsonRes({ ok: true });
    }

    if (method === 'PUT') {
      const className = clampString(body?.className ?? target.className, 40);
      const gradeLevel = Number(body?.gradeLevel) || extractGradeLevel(className);
      const homeroomTeacher = clampString(body?.homeroomTeacher ?? target.homeroomTeacher, 120);
      const companionTeacher = clampString(
        body?.companionTeacher ?? target.companionTeacher ?? getClassPreset(className)?.companionTeacher,
        120,
        ''
      );
      const studentCount = Number(body?.studentCount ?? target.studentCount);
      const dayOfWeek = clampString(body?.dayOfWeek ?? target.dayOfWeek, 20);
      const scheduleDate = clampString(body?.scheduleDate ?? target.scheduleDate, 32, '');
      const startTime = clampString(body?.startTime ?? target.startTime, 10);
      const endTime = clampString(body?.endTime ?? target.endTime, 10);
      const roomArea = clampString(body?.roomArea ?? target.roomArea, 100);
      const readingMode = clampString(body?.readingMode ?? target.readingMode, 80);
      const readingTheme = clampString(body?.readingTheme ?? target.readingTheme, 200, '');
      const sessionNotes = clampString(body?.sessionNotes ?? target.sessionNotes, 500, '');

      const validation = validateSchedulePayload({
        className,
        homeroomTeacher,
        companionTeacher: companionTeacher || undefined,
        studentCount,
        dayOfWeek,
        startTime,
        endTime,
        roomArea,
        readingMode,
      });
      if (!validation.ok) return jsonRes({ error: validation.reason }, 400);

      const activeDocs = allDocs.filter((d) => !d.archived);
      const conflict = detectScheduleConflict(
        { id: Number(target.numericId), className, dayOfWeek, startTime, endTime, roomArea },
        activeDocs.map(toScheduleDomain)
      );
      if (conflict.hasConflict) {
        return jsonRes({ error: conflict.reason, conflict: true }, 409);
      }

      const catalogDocs = await listCollection('public_catalog', [where('archived', '==', false)]);
      const bookNumericId =
        body?.bookId !== undefined ? Number(body.bookId || 0) : Number(target.bookNumericId || 0);
      const bookDoc = bookNumericId
        ? catalogDocs.find((b) => Number(b.numericId) === bookNumericId)
        : undefined;

      try {
        await updateDoc(doc(db, 'reading_schedules', target.id), {
          className,
          gradeLevel,
          homeroomTeacher,
          companionTeacher,
          studentCount,
          dayOfWeek,
          scheduleDate,
          startTime,
          endTime,
          roomArea,
          readingMode,
          readingTheme,
          bookId: bookDoc ? bookDoc.id : '',
          bookNumericId: bookDoc ? Number(bookDoc.numericId) : 0,
          bookTitle: bookDoc ? clampString(bookDoc.title, 240) : '',
          sessionNotes,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `reading_schedules/${target.id}`);
      }
      await writeAuditLog(
        actor,
        'SCHEDULE_UPDATE',
        'reading_schedules',
        String(target.scheduleCode),
        `${className} · ${dayOfWeek} ${startTime}-${endTime}`
      );
      return jsonRes({ ok: true });
    }

    // PATCH: status or log_session
    const action = String(body?.action || 'log_session');
    if (action === 'status') {
      const nextStatus = String(body?.status || '') as ScheduleStatus;
      if (!SCHEDULE_STATUSES.includes(nextStatus)) {
        return jsonRes({ error: 'Status jadwal tidak valid.' }, 400);
      }
      if (target.status === 'Dibatalkan' && nextStatus !== 'Dibatalkan') {
        const activeDocs = allDocs.filter((d) => !d.archived);
        const conflict = detectScheduleConflict(
          {
            id: Number(target.numericId),
            className: String(target.className),
            dayOfWeek: String(target.dayOfWeek),
            startTime: String(target.startTime),
            endTime: String(target.endTime),
            roomArea: String(target.roomArea),
          },
          activeDocs.map(toScheduleDomain)
        );
        if (conflict.hasConflict) {
          return jsonRes({ error: conflict.reason, conflict: true }, 409);
        }
      }
      try {
        await updateDoc(doc(db, 'reading_schedules', target.id), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `reading_schedules/${target.id}`);
      }
      await writeAuditLog(
        actor,
        'SCHEDULE_STATUS_CHANGE',
        'reading_schedules',
        String(target.scheduleCode),
        `Status -> ${nextStatus}`
      );
      return jsonRes({ ok: true, status: nextStatus });
    }

    const nextStatus = String(body?.status || 'Selesai');
    const notes = clampString(body?.notes, 500, '');
    const sessionDate = clampString(body?.sessionDate, 32, formatIsoDate(new Date()));
    const rawAttendance = Array.isArray(body?.attendance)
      ? (body.attendance as Array<{
          studentId: number | string;
          status: string;
          booksRead?: number;
          note?: string;
        }>)
      : null;

    let resolvedAttendance: AttendanceRecordItem[] = [];
    let studentsPresent = Number(body?.studentsPresent ?? target.studentCount);
    let booksReadCount = Number(body?.booksReadCount ?? studentsPresent);
    let effectiveStudentCount = Number(target.studentCount || 10);

    if (rawAttendance && rawAttendance.length > 0) {
      const attCheck = validateAttendanceEntries(rawAttendance);
      if (!attCheck.ok) return jsonRes({ error: attCheck.reason }, 400);

      const classDocs = await ensureSchoolClassesDocs();
      const clsDoc = classDocs.find((c) => String(c.className) === String(target.className));
      const clsStudents = Array.isArray(clsDoc?.students)
        ? (clsDoc.students as Array<Record<string, unknown>>).filter((s) => !s.archived)
        : [];
      const stMap = new Map(clsStudents.map((s) => [String(s.id), s]));

      resolvedAttendance = rawAttendance.map((item) => {
        const st = stMap.get(String(item.studentId));
        const stStatus = item.status as AttendanceStatus;
        return {
          studentId: String(item.studentId),
          studentCode: String(st?.studentCode || ''),
          studentName: String(st?.fullName || `Siswa ${item.studentId}`),
          status: stStatus,
          booksRead: stStatus === 'Hadir' ? Math.max(0, Number(item.booksRead ?? 0)) : 0,
          note: clampString(item.note, 160, ''),
        };
      });
      const attSummary = summarizeSessionAttendance(resolvedAttendance);
      studentsPresent = attSummary.presentCount;
      booksReadCount = attSummary.totalBooksRead;
      effectiveStudentCount = Math.max(effectiveStudentCount, resolvedAttendance.length);
    }

    const check = validateCompletionLog({
      status: nextStatus,
      studentsPresent,
      studentCount: effectiveStudentCount,
      booksReadCount,
    });
    if (!check.ok) return jsonRes({ error: check.reason }, 400);

    const existingLogs = Array.isArray(target.sessionLogs)
      ? (target.sessionLogs as Array<Record<string, unknown>>)
      : [];
    const newLog = {
      id: Date.now(),
      sessionDate,
      status: nextStatus,
      studentsPresent,
      booksReadCount,
      notes,
      recordedByName: clampString(actor.fullName, 120, 'Pustakawan'),
      createdAt: `${sessionDate} ${new Date().toTimeString().slice(0, 8)}`,
      attendance: resolvedAttendance,
    };
    const nextLogs = [newLog, ...existingLogs].slice(0, 50);

    try {
      await updateDoc(doc(db, 'reading_schedules', target.id), {
        status: nextStatus,
        studentCount: effectiveStudentCount,
        studentsPresent,
        booksReadCount,
        sessionNotes: notes,
        completedAt:
          nextStatus === 'Selesai'
            ? `${sessionDate} ${new Date().toTimeString().slice(0, 8)}`
            : String(target.completedAt || ''),
        sessionLogs: nextLogs,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reading_schedules/${target.id}`);
    }
    await writeAuditLog(
      actor,
      'SCHEDULE_SESSION_LOG',
      'reading_schedules',
      String(target.scheduleCode),
      `${target.className} · ${nextStatus} (${studentsPresent} hadir, ${booksReadCount} buku)`
    );
    return jsonRes({ ok: true });
  }

  return jsonRes({ error: `Endpoint ${pathname} belum tersedia di mode Firestore.` }, 404);
}
