'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Download,
  Edit3,
  Eye,
  LayoutGrid,
  List,
  Plus,
  Printer,
  QrCode,
  Upload,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { BookCoverThumb } from '@/components/books/BookCoverThumb';
import { BookFormModal, type BookFormRow } from '@/components/books/BookFormModal';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Pagination,
  QrCodeImage,
  SearchField,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import {
  exportToCsv,
  exportToExcel,
  exportToPdf,
  parseSpreadsheetFile,
} from '@/lib/client/export';
import { formatCurrencyIDR } from '@/lib/domain/library-rules';

type BookRow = BookFormRow;

interface CopyItem {
  id: number;
  inventory_code: string;
  barcode: string;
  condition: string;
  status: string;
  shelf_code: string | null;
  shelf_name: string | null;
}

export default function BooksPage() {
  const { user, library, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canManageBooks = can('books.write');
  const [books, setBooks] = useState<BookRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [shelves, setShelves] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [page, setPage] = useState(1);
  const perPage = 8;

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<BookRow | null>(null);
  const [detailBook, setDetailBook] = useState<{
    book: BookRow;
    copies: CopyItem[];
    history: Array<Record<string, unknown>>;
  } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<BookRow | null>(null);
  const [labelTarget, setLabelTarget] = useState<{ book: BookRow; copies: CopyItem[] } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Add copies quick form inside detail
  const [addCopyCount, setAddCopyCount] = useState('1');

  // Import state
  const [importPreview, setImportPreview] = useState<{
    total: number;
    validCount: number;
    invalidCount: number;
    rows: Array<{
      rowNumber: number;
      title: string;
      isbn: string;
      authors: string;
      valid: boolean;
      errors: string[];
    }>;
  } | null>(null);
  const [rawImportRows, setRawImportRows] = useState<Array<Record<string, unknown>>>([]);
  const [skipInvalid, setSkipInvalid] = useState(true);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (categoryId) sp.set('categoryId', categoryId);
      sp.set('sortBy', sortBy);
      const res = await gatewayFetch(`/api/books?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data buku.');
      setBooks(data.books || []);
      setCategories(data.categories || []);
      setShelves(data.shelves || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat buku.');
    } finally {
      setLoading(false);
    }
  }, [q, categoryId, sortBy]);

  useEffect(() => {
    if (authLoading || !user || !canManageBooks) return;
    let active = true;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (categoryId) sp.set('categoryId', categoryId);
    sp.set('sortBy', sortBy);
    gatewayFetch(`/api/books?${sp.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data buku.');
        if (active) {
          setBooks(data.books || []);
          setCategories(data.categories || []);
          setShelves(data.shelves || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat buku.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canManageBooks, q, categoryId, sortBy]);

  const totalPages = Math.max(1, Math.ceil(books.length / perPage));
  const pagedBooks = useMemo(() => {
    const start = (page - 1) * perPage;
    return books.slice(start, start + perPage);
  }, [books, page]);

  function openCreate() {
    setEditingBook(null);
    setFormOpen(true);
  }

  function openEdit(b: BookRow) {
    setEditingBook(b);
    setFormOpen(true);
  }

  async function openDetail(b: BookRow) {
    try {
      const res = await gatewayFetch(`/api/books/${b.id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat detail buku.');
      setDetailBook(data);
    } catch (err) {
      showToast('error', 'Gagal memuat detail', err instanceof Error ? err.message : 'Error');
    }
  }

  async function openLabels(b: BookRow) {
    try {
      const res = await gatewayFetch(`/api/books/${b.id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat label.');
      setLabelTarget({ book: data.book, copies: data.copies });
    } catch (err) {
      showToast('error', 'Gagal memuat label', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleAddCopies() {
    if (!detailBook) return;
    try {
      const res = await gatewayFetch(`/api/books/${detailBook.book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_copies',
          count: Number(addCopyCount || 1),
          shelfId: shelves[0]?.id || null,
        }),
      });
      if (!res.ok) throw new Error('Gagal menambah eksemplar.');
      showToast('success', 'Eksemplar ditambahkan', `${addCopyCount} eksemplar baru berhasil dibuat.`);
      await openDetail(detailBook.book);
      loadBooks();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    try {
      const res = await gatewayFetch(`/api/books/${archiveTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengarsipkan buku.');
      showToast('success', 'Buku diarsipkan', archiveTarget.title);
      setArchiveTarget(null);
      loadBooks();
    } catch (err) {
      showToast('error', 'Tidak dapat mengarsipkan', err instanceof Error ? err.message : 'Error');
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      setRawImportRows(parsed);
      const res = await gatewayFetch('/api/books/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memvalidasi berkas.');
      setImportPreview(data);
    } catch (err) {
      showToast('error', 'Import gagal', err instanceof Error ? err.message : 'Format berkas tidak valid.');
    }
  }

  async function commitImport() {
    try {
      const res = await gatewayFetch('/api/books/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', rows: rawImportRows, skipInvalid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengimpor data.');
      showToast('success', 'Import selesai', `${data.importedCount} judul buku berhasil ditambahkan.`);
      setImportOpen(false);
      setImportPreview(null);
      loadBooks();
    } catch (err) {
      showToast('error', 'Gagal import', err instanceof Error ? err.message : 'Error');
    }
  }

  const exportRows = books.map((b) => ({
    Judul: b.title,
    Subjudul: b.subtitle || '-',
    ISBN: b.isbn || '-',
    DDC: b.ddc_code || '-',
    Nomor_Panggil: b.call_number || '-',
    Penulis: b.authors || '-',
    Penerbit: b.publisher_name || '-',
    Tahun: b.publish_year,
    Kategori: b.category_name || '-',
    Target_Kelas: b.target_grade || '-',
    Total_Eksemplar: b.total_copies,
    Tersedia: b.available_copies,
    Harga: b.price,
    Link_Cover: b.cover_url || '-',
  }));

  return (
    <AppShell
      title="Manajemen Data Buku"
      description="Kelola bibliografi lengkap, link cover, klasifikasi DDC, dan inventaris fisik setiap eksemplar."
      requiredPermission="books.write"
      actions={
        <>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" />
            Import CSV/Excel
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportToExcel('koleksi-buku.xlsx', 'Koleksi', exportRows)}
          >
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              exportToPdf('koleksi-buku.pdf', `Daftar Koleksi — ${library.name}`, exportRows, library)
            }
          >
            Export PDF
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Tambah Buku
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-4">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <SearchField
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="Cari judul, subjudul, ISBN, DDC, penulis, atau subjek..."
              ariaLabel="Cari data buku"
              className="w-full sm:w-80"
            />
            <select
              aria-label="Filter kategori"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm text-slate-800"
            >
              <option value="">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Urutkan buku"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm text-slate-800"
            >
              <option value="created_at">Urut: Terbaru</option>
              <option value="title">Urut: Judul (A-Z)</option>
              <option value="publish_year">Urut: Tahun Terbit</option>
              <option value="price">Urut: Nilai Buku</option>
            </select>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Tampilan tabel"
              className={`rounded-md p-1.5 cursor-pointer ${viewMode === 'table' ? 'bg-[#FAF9F5] text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-label="Tampilan kartu"
              className={`rounded-md p-1.5 cursor-pointer ${viewMode === 'cards' ? 'bg-[#FAF9F5] text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={loadBooks} />}

        {!loading && !error && books.length === 0 && (
          <EmptyState
            title="Belum ada buku yang sesuai"
            description="Tambahkan judul buku baru atau ubah kata kunci pencarian Anda."
            action={<Button onClick={openCreate}>Tambah Buku Pertama</Button>}
          />
        )}

        {!loading && !error && books.length > 0 && viewMode === 'table' && (
          <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Buku & Pengarang</th>
                    <th className="px-4 py-3">ISBN / Klasifikasi</th>
                    <th className="px-4 py-3">Kategori & Target</th>
                    <th className="px-4 py-3">Lokasi Rak</th>
                    <th className="px-4 py-3 text-right">Eksemplar</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {pagedBooks.map((b) => (
                    <tr key={b.id} className="hover:bg-[#F4F3EE]/80">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[240px]">
                          <BookCoverThumb
                            src={b.cover_url}
                            title={b.title}
                            size="xs"
                            showFallbackTitle={false}
                            className="h-12 w-9 shrink-0 rounded border border-[#E2DFD7]"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 line-clamp-1">{b.title}</p>
                            {b.subtitle && (
                              <p className="text-[11px] text-[#5C5E64] line-clamp-1">{b.subtitle}</p>
                            )}
                            <p className="text-xs text-slate-500 truncate">
                              {b.authors || '-'} · {b.publish_year}
                              {b.pages ? ` · ${b.pages} hlm` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                        <p>{b.isbn || '-'}</p>
                        {(b.call_number || b.ddc_code) && (
                          <p className="mt-0.5 text-[11px] text-[#7B7D82]">
                            {b.call_number || `DDC ${b.ddc_code}`}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <p className="font-medium text-[#1E2433]">{b.category_name || '-'}</p>
                        {b.target_grade && (
                          <p className="text-[11px] text-[#7B7D82]">{b.target_grade}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {b.primary_shelf || '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        <span className="font-semibold text-slate-900">{b.available_copies}</span>
                        <span className="text-slate-400"> / {b.total_copies}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openDetail(b)}
                            aria-label={`Detail ${b.title}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openLabels(b)}
                            aria-label={`Cetak label QR ${b.title}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          >
                            <QrCode className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            aria-label={`Edit ${b.title}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiveTarget(b)}
                            aria-label={`Arsipkan ${b.title}`}
                            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={books.length}
              onPageChange={setPage}
            />
          </div>
        )}

        {!loading && !error && books.length > 0 && viewMode === 'cards' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {pagedBooks.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-3.5"
                >
                  <BookCoverThumb
                    src={b.cover_url}
                    title={b.title}
                    size="md"
                    className="aspect-[2/3] w-full rounded-lg border border-[#E2DFD7]"
                  />
                  <div className="mt-3 flex items-center justify-between text-[11px] text-[#7B7D82]">
                    <span className="truncate">{b.category_name || 'Umum'}</span>
                    <span className="font-mono tabular-nums">{b.publish_year}</span>
                  </div>
                  <h3 className="mt-1 line-clamp-2 font-serif text-sm font-semibold text-[#1E2433]">
                    {b.title}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-[#5C5E64]">{b.authors || '-'}</p>
                  <p className="mt-1.5 font-mono text-[11px] text-[#7B7D82] truncate">
                    {b.call_number || b.isbn || '-'}
                  </p>
                  <div className="mt-auto pt-3 flex items-center justify-between border-t border-[#EAE7DF]">
                    <span className="font-mono text-xs font-semibold text-[#E56B63] tabular-nums">
                      {b.available_copies}/{b.total_copies} eks
                    </span>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                        Edit
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openDetail(b)}>
                        Detail
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              totalItems={books.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Comprehensive Add / Edit Book Modal */}
      <BookFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editingBook={editingBook}
        categories={categories}
        shelves={shelves}
        onSaved={loadBooks}
      />

      {/* Book Detail & Copies Modal */}
      <Modal
        open={Boolean(detailBook)}
        onClose={() => setDetailBook(null)}
        title={detailBook?.book.title || 'Detail Buku'}
        description={
          detailBook
            ? `${detailBook.book.subtitle ? `${detailBook.book.subtitle} · ` : ''}ISBN: ${detailBook.book.isbn || '-'} · Nilai: ${formatCurrencyIDR(detailBook.book.price || 0)}`
            : ''
        }
        maxWidth="max-w-4xl"
      >
        {detailBook && (
          <div className="space-y-6">
            {/* Bibliographic Overview Header */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-12">
              <div className="sm:col-span-3">
                <BookCoverThumb
                  src={detailBook.book.cover_url}
                  title={detailBook.book.title}
                  size="lg"
                  className="mx-auto aspect-[2/3] w-40 sm:w-full rounded-lg border border-[#E2DFD7] shadow-sm"
                />
              </div>

              <div className="space-y-4 sm:col-span-9">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-[#E56B63]">
                      {detailBook.book.category_name || 'Umum'}
                      {detailBook.book.subcategory ? ` · ${detailBook.book.subcategory}` : ''}
                      {detailBook.book.series_name
                        ? ` · ${detailBook.book.series_name}${detailBook.book.volume ? ` (${detailBook.book.volume})` : ''}`
                        : ''}
                    </p>
                    <p className="mt-1 text-xs text-[#5C5E64]">
                      Penulis: <strong className="text-[#1E2433]">{detailBook.book.authors || '-'}</strong>
                      {detailBook.book.illustrator ? ` · Ilustrator: ${detailBook.book.illustrator}` : ''}
                      {detailBook.book.editor ? ` · Editor: ${detailBook.book.editor}` : ''}
                      {detailBook.book.translator ? ` · Penerjemah: ${detailBook.book.translator}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const target = detailBook.book;
                      setDetailBook(null);
                      openEdit(target);
                    }}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit Data Lengkap
                  </Button>
                </div>

                {detailBook.book.description && (
                  <p className="text-xs leading-relaxed text-[#4A4945]">
                    {detailBook.book.description}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-[#E7E4DC] bg-white p-3.5 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">ISBN</dt>
                    <dd className="font-mono text-[#1E2433]">{detailBook.book.isbn || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">DDC / Nomor Panggil</dt>
                    <dd className="font-mono text-[#1E2433]">
                      {detailBook.book.ddc_code || '-'}
                      {detailBook.book.call_number ? ` · ${detailBook.book.call_number}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Penerbit & Terbit</dt>
                    <dd className="text-[#1E2433]">
                      {detailBook.book.publisher_name || '-'}
                      {detailBook.book.publish_city ? `, ${detailBook.book.publish_city}` : ''} (
                      {detailBook.book.publish_year})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Edisi & Bahasa</dt>
                    <dd className="text-[#1E2433]">
                      {detailBook.book.edition || '-'} · {detailBook.book.language || 'Indonesia'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Target Pembaca</dt>
                    <dd className="text-[#1E2433]">
                      {detailBook.book.target_grade || '-'}
                      {detailBook.book.age_range ? ` (${detailBook.book.age_range})` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Spesifikasi Fisik</dt>
                    <dd className="text-[#1E2433] tabular-nums">
                      {detailBook.book.pages || 0} hlm
                      {detailBook.book.dimensions ? ` · ${detailBook.book.dimensions}` : ''}
                      {detailBook.book.weight_grams ? ` · ${detailBook.book.weight_grams} g` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Jilid & Kertas</dt>
                    <dd className="text-[#1E2433]">
                      {detailBook.book.binding_type || '-'}
                      {detailBook.book.paper_type ? ` · ${detailBook.book.paper_type}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Perolehan & Tanggal</dt>
                    <dd className="text-[#1E2433] tabular-nums">
                      {detailBook.book.acquisition_source || '-'}
                      {detailBook.book.acquisition_date ? ` (${detailBook.book.acquisition_date})` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7B7D82]">Nilai Aset</dt>
                    <dd className="font-mono font-medium text-[#1E2433] tabular-nums">
                      {formatCurrencyIDR(detailBook.book.price || 0)}
                    </dd>
                  </div>
                  {detailBook.book.illustration_notes && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[11px] text-[#7B7D82]">Catatan Ilustrasi</dt>
                      <dd className="text-[#1E2433]">{detailBook.book.illustration_notes}</dd>
                    </div>
                  )}
                  {detailBook.book.subjects && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[11px] text-[#7B7D82]">Subjek / Kata Kunci</dt>
                      <dd className="text-[#1E2433]">{detailBook.book.subjects}</dd>
                    </div>
                  )}
                  {detailBook.book.table_of_contents && (
                    <div className="col-span-2 sm:col-span-3">
                      <dt className="text-[11px] text-[#7B7D82]">Daftar Isi / Poin Materi</dt>
                      <dd className="whitespace-pre-line text-[#1E2433]">
                        {detailBook.book.table_of_contents}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Daftar Eksemplar ({detailBook.copies.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Setiap eksemplar memiliki kode inventaris dan barcode unik.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  aria-label="Jumlah eksemplar tambahan"
                  value={addCopyCount}
                  onChange={(e) => setAddCopyCount(e.target.value)}
                  className="h-9 w-20 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-2 text-sm tabular-nums"
                />
                <Button size="sm" onClick={handleAddCopies}>
                  + Tambah Eksemplar
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Kode Inventaris</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Rak</th>
                    <th className="px-3 py-2">Kondisi</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {detailBook.copies.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-mono font-medium text-slate-900">
                        {c.inventory_code}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">{c.barcode}</td>
                      <td className="px-3 py-2 text-slate-600">{c.shelf_code || '-'}</td>
                      <td className="px-3 py-2">
                        <StatusIndicator status={c.condition} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <StatusIndicator status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">
                Riwayat Sirkulasi Buku
              </h3>
              {detailBook.history.length === 0 ? (
                <p className="text-xs text-slate-500">Belum pernah dipinjam.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Transaksi</th>
                        <th className="px-3 py-2">Eksemplar</th>
                        <th className="px-3 py-2">Anggota</th>
                        <th className="px-3 py-2">Pinjam</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {detailBook.history.map((h) => (
                        <tr key={String(h.id)}>
                          <td className="px-3 py-2 font-mono">{String(h.loan_number)}</td>
                          <td className="px-3 py-2 font-mono">{String(h.inventory_code)}</td>
                          <td className="px-3 py-2">{String(h.member_name)}</td>
                          <td className="px-3 py-2 font-mono">{String(h.loan_date)}</td>
                          <td className="px-3 py-2 text-right">
                            <StatusIndicator status={String(h.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Print QR / Barcode Labels Modal */}
      <Modal
        open={Boolean(labelTarget)}
        onClose={() => setLabelTarget(null)}
        title="Cetak Label Buku & QR Code"
        maxWidth="max-w-3xl"
      >
        {labelTarget && (
          <div className="space-y-4">
            <div className="no-print flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setLabelTarget(null)}>
                Tutup
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Cetak Label
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {labelTarget.copies.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 rounded-lg border border-[#DFDCD4] bg-[#FAF9F5] p-4"
                >
                  <QrCodeImage value={c.barcode} size={84} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {library.name}
                    </p>
                    <p className="line-clamp-2 text-xs font-semibold text-slate-900">
                      {labelTarget.book.title}
                    </p>
                    {labelTarget.book.call_number && (
                      <p className="mt-0.5 font-mono text-[11px] font-medium text-[#1E2433]">
                        {labelTarget.book.call_number}
                      </p>
                    )}
                    <p className="mt-0.5 font-mono text-xs font-bold text-[#E56B63]">
                      {c.inventory_code}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {c.barcode} · Rak {c.shelf_code || '-'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* Import Excel / CSV Modal */}
      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportPreview(null);
        }}
        title="Import Koleksi via CSV / Excel (.xlsx)"
        description="Unggah berkas dengan kolom: title, subtitle, isbn, authors, publisher, publishYear, category, ddcCode, callNumber, targetGrade, coverUrl, price, copies."
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-4">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Pilih berkas CSV atau Excel"
              onChange={handleImportFile}
              className="text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#222B3A] file:px-3 file:py-2 file:text-xs file:font-medium file:text-white"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportToCsv('template-import-buku.csv', [
                  {
                    title: 'Petualangan Sahabat Hutan Nusantara',
                    subtitle: 'Kisah Persahabatan Satwa Indonesia',
                    isbn: '978-602-999-001-1',
                    authors: 'Kak Bimo',
                    publisher: 'Erlangga for Kids',
                    publishYear: 2025,
                    category: 'Cerita Anak & Dongeng',
                    ddcCode: '813',
                    callNumber: '813 BIM p',
                    targetGrade: 'Kelas Rendah (1–3 SD)',
                    coverUrl: 'https://picsum.photos/seed/buku-hutan/400/600',
                    price: 65000,
                    copies: 2,
                  },
                ])
              }
            >
              Unduh Template CSV
            </Button>
          </div>

          {importPreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span>
                  Total: <strong>{importPreview.total}</strong> · Valid:{' '}
                  <strong className="text-emerald-700">{importPreview.validCount}</strong> ·
                  Bermasalah:{' '}
                  <strong className="text-red-700">{importPreview.invalidCount}</strong>
                </span>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(e) => setSkipInvalid(e.target.checked)}
                  />
                  Lewati baris bermasalah saat konfirmasi
                </label>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-[#E7E4DC]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Judul</th>
                      <th className="px-3 py-2">ISBN</th>
                      <th className="px-3 py-2">Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {importPreview.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="px-3 py-2 font-mono">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.title || '-'}</td>
                        <td className="px-3 py-2 font-mono">{r.isbn || '-'}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <StatusIndicator status="Valid" />
                          ) : (
                            <span className="text-red-700">{r.errors.join(', ')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setImportOpen(false)}>
                  Batal
                </Button>
                <Button onClick={commitImport} disabled={importPreview.validCount === 0}>
                  Konfirmasi Import ({importPreview.validCount} Buku)
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title="Arsipkan Judul Buku"
        message={`Buku "${archiveTarget?.title}" akan diarsipkan (soft delete) sehingga riwayat transaksi tetap terjaga. Lanjutkan?`}
        confirmLabel="Ya, Arsipkan"
      />
    </AppShell>
  );
}
