'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Hash,
  Image as ImageIcon,
  Layers,
  Link2,
  Package,
  Sparkles,
  UserPen,
  X,
} from 'lucide-react';
import {
  Button,
  Modal,
  SelectField,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { BookCoverThumb, type CoverLoadStatus } from '@/components/books/BookCoverThumb';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import {
  BOOK_ACQUISITION_SOURCES,
  BOOK_BINDING_TYPES,
  BOOK_COPY_CONDITIONS,
  BOOK_LANGUAGES,
  BOOK_PAPER_TYPES,
  BOOK_TARGET_GRADES,
  PRESET_COVER_LINKS,
  computeCatalogCompleteness,
  generateCallNumber,
  validateBookFormInput,
  validateCoverUrl,
  type BookFormValues,
} from '@/lib/domain/book-catalog-rules';
import { formatCurrencyIDR } from '@/lib/domain/library-rules';

export interface BookFormRow {
  id: number;
  title: string;
  subtitle?: string;
  series_name?: string;
  volume?: string;
  isbn: string | null;
  edition: string;
  publish_year: number;
  publish_city?: string;
  language: string;
  description: string;
  table_of_contents?: string;
  pages: number;
  dimensions?: string;
  binding_type?: string;
  paper_type?: string;
  weight_grams?: number;
  illustration_notes?: string;
  cover_url: string;
  price: number;
  category_id: number | null;
  category_name: string | null;
  publisher_name: string | null;
  authors: string | null;
  illustrator?: string;
  editor?: string;
  translator?: string;
  subcategory: string;
  ddc_code?: string;
  call_number?: string;
  subjects?: string;
  target_grade?: string;
  age_range?: string;
  acquisition_source?: string;
  acquisition_date?: string;
  is_reference_only: number;
  read_in_place_only: number;
  is_featured?: number;
  total_copies: number;
  available_copies: number;
  primary_shelf: string | null;
}

interface BookFormModalProps {
  open: boolean;
  onClose: () => void;
  editingBook: BookFormRow | null;
  categories: Array<{ id: number; name: string }>;
  shelves: Array<{ id: number; code: string; name: string }>;
  onSaved: () => void;
}

const SECTIONS = [
  { id: 'sec-identitas', label: '1. Sampul & Identitas', icon: ImageIcon },
  { id: 'sec-pengarang', label: '2. Pengarang & Terbit', icon: UserPen },
  { id: 'sec-klasifikasi', label: '3. Klasifikasi & Subjek', icon: Hash },
  { id: 'sec-fisik', label: '4. Fisik & Konten', icon: Layers },
  { id: 'sec-inventaris', label: '5. Perolehan & Rak', icon: Package },
] as const;

function buildInitialValues(
  editingBook: BookFormRow | null,
  categories: Array<{ id: number; name: string }>,
  shelves: Array<{ id: number; code: string; name: string }>
): BookFormValues {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (editingBook) {
    return {
      title: editingBook.title || '',
      subtitle: editingBook.subtitle || '',
      seriesName: editingBook.series_name || '',
      volume: editingBook.volume || '',
      coverUrl: editingBook.cover_url || '',
      authors: editingBook.authors || '',
      illustrator: editingBook.illustrator || '',
      editor: editingBook.editor || '',
      translator: editingBook.translator || '',
      publisher: editingBook.publisher_name || '',
      publishCity: editingBook.publish_city || '',
      publishYear: String(editingBook.publish_year || new Date().getFullYear()),
      edition: editingBook.edition || 'Cetakan 1',
      language: editingBook.language || 'Indonesia',
      isbn: editingBook.isbn || '',
      ddcCode: editingBook.ddc_code || '',
      callNumber: editingBook.call_number || '',
      categoryId: editingBook.category_id ? String(editingBook.category_id) : '',
      subcategory: editingBook.subcategory || '',
      subjects: editingBook.subjects || '',
      targetGrade: editingBook.target_grade || 'Semua Kelas (1–6 SD)',
      ageRange: editingBook.age_range || '',
      pages: editingBook.pages ? String(editingBook.pages) : '',
      dimensions: editingBook.dimensions || '',
      bindingType: editingBook.binding_type || 'Softcover (Art Carton)',
      paperType: editingBook.paper_type || '',
      weightGrams: editingBook.weight_grams ? String(editingBook.weight_grams) : '',
      illustrationNotes: editingBook.illustration_notes || '',
      description: editingBook.description || '',
      tableOfContents: editingBook.table_of_contents || '',
      acquisitionSource: editingBook.acquisition_source || 'Pembelian Dana BOS',
      acquisitionDate: editingBook.acquisition_date || todayIso,
      price: editingBook.price !== undefined && editingBook.price !== null ? String(editingBook.price) : '0',
      shelfId: shelves[0] ? String(shelves[0].id) : '',
      copiesCount: '1',
      condition: 'Baik',
      inventoryCode: '',
      copyNotes: '',
      isReferenceOnly: editingBook.is_reference_only === 1,
      readInPlaceOnly: editingBook.read_in_place_only === 1,
      isFeatured: editingBook.is_featured === 1,
    };
  }

  return {
    title: '',
    subtitle: '',
    seriesName: '',
    volume: '',
    coverUrl: '',
    authors: '',
    illustrator: '',
    editor: '',
    translator: '',
    publisher: '',
    publishCity: '',
    publishYear: String(new Date().getFullYear()),
    edition: 'Cetakan 1',
    language: 'Indonesia',
    isbn: '',
    ddcCode: '',
    callNumber: '',
    categoryId: categories[0] ? String(categories[0].id) : '',
    subcategory: '',
    subjects: '',
    targetGrade: 'Semua Kelas (1–6 SD)',
    ageRange: '7–12 tahun',
    pages: '96',
    dimensions: '17 × 24 cm',
    bindingType: 'Softcover (Art Carton)',
    paperType: 'HVS 70/80 gsm',
    weightGrams: '',
    illustrationNotes: 'Berwarna penuh (Full Color)',
    description: '',
    tableOfContents: '',
    acquisitionSource: 'Pembelian Dana BOS',
    acquisitionDate: todayIso,
    price: '65000',
    shelfId: shelves[0] ? String(shelves[0].id) : '',
    copiesCount: '2',
    condition: 'Baik',
    inventoryCode: '',
    copyNotes: '',
    isReferenceOnly: false,
    readInPlaceOnly: false,
    isFeatured: false,
  };
}

export function BookFormModal({
  open,
  onClose,
  editingBook,
  categories,
  shelves,
  onSaved,
}: BookFormModalProps) {
  const formKey = open
    ? `${editingBook ? `edit-${editingBook.id}` : 'create'}-${categories.length}-${shelves.length}`
    : 'closed';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingBook ? 'Edit Katalog Bibliografi Buku' : 'Input Katalog Buku Lengkap'}
      description="Lengkapi data bibliografi, link sampul (URL), klasifikasi DDC, spesifikasi fisik, dan inventaris rak."
      maxWidth="max-w-5xl"
    >
      {open && (
        <BookFormContent
          key={formKey}
          onClose={onClose}
          editingBook={editingBook}
          categories={categories}
          shelves={shelves}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function BookFormContent({
  onClose,
  editingBook,
  categories,
  shelves,
  onSaved,
}: Omit<BookFormModalProps, 'open'>) {
  const { showToast } = useToast();
  const [values, setValues] = useState<BookFormValues>(() =>
    buildInitialValues(editingBook, categories, shelves)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const [coverStatus, setCoverStatus] = useState<CoverLoadStatus>('empty');
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const setField = useCallback(
    <K extends keyof BookFormValues>(key: K, val: BookFormValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  const completeness = useMemo(() => computeCatalogCompleteness(values), [values]);
  const coverUrlValidation = useMemo(() => validateCoverUrl(values.coverUrl), [values.coverUrl]);

  const selectedCategoryName = useMemo(() => {
    const match = categories.find((c) => String(c.id) === values.categoryId);
    return match?.name || 'Kategori Umum';
  }, [categories, values.categoryId]);

  const selectedShelfLabel = useMemo(() => {
    const match = shelves.find((s) => String(s.id) === values.shelfId);
    return match ? `${match.code} — ${match.name}` : 'Belum dipilih';
  }, [shelves, values.shelfId]);

  function jumpToSection(sectionId: string) {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function handleAutoCallNumber() {
    if (!values.ddcCode.trim() && !values.authors.trim() && !values.title.trim()) {
      showToast(
        'info',
        'Isi DDC, Penulis, atau Judul',
        'Masukkan minimal kode DDC, penulis, atau judul untuk menyusun nomor panggil otomatis.'
      );
      return;
    }
    const generated = generateCallNumber({
      ddcCode: values.ddcCode,
      authors: values.authors,
      title: values.title,
    });
    setField('callNumber', generated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateBookFormInput(values, { isEditing: Boolean(editingBook) });
    if (!validation.valid) {
      setErrors(validation.errors);
      const firstErrorMsg = Object.values(validation.errors)[0];
      showToast('error', 'Periksa kembali formulir buku', firstErrorMsg);
      const firstKey = Object.keys(validation.errors)[0];
      if (firstKey) {
        const target = formRef.current?.querySelector(`[name="${firstKey}"]`) as HTMLElement | null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.focus();
      }
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: values.title.trim(),
        subtitle: values.subtitle.trim(),
        seriesName: values.seriesName.trim(),
        volume: values.volume.trim(),
        coverUrl: values.coverUrl.trim(),
        authors: values.authors.trim(),
        illustrator: values.illustrator.trim(),
        editor: values.editor.trim(),
        translator: values.translator.trim(),
        publisher: values.publisher.trim(),
        publishCity: values.publishCity.trim(),
        publishYear: values.publishYear ? Number(values.publishYear) : new Date().getFullYear(),
        edition: values.edition.trim() || 'Cetakan 1',
        language: values.language.trim() || 'Indonesia',
        isbn: values.isbn.trim() || null,
        ddcCode: values.ddcCode.trim(),
        callNumber: values.callNumber.trim(),
        categoryId: values.categoryId ? Number(values.categoryId) : null,
        subcategory: values.subcategory.trim(),
        subjects: values.subjects.trim(),
        targetGrade: values.targetGrade.trim(),
        ageRange: values.ageRange.trim(),
        pages: values.pages ? Number(values.pages) : 0,
        dimensions: values.dimensions.trim(),
        bindingType: values.bindingType.trim(),
        paperType: values.paperType.trim(),
        weightGrams: values.weightGrams ? Number(values.weightGrams) : 0,
        illustrationNotes: values.illustrationNotes.trim(),
        description: values.description.trim(),
        tableOfContents: values.tableOfContents.trim(),
        acquisitionSource: values.acquisitionSource.trim(),
        acquisitionDate: values.acquisitionDate.trim(),
        price: values.price ? Number(values.price) : 0,
        shelfId: values.shelfId ? Number(values.shelfId) : null,
        copiesCount: values.copiesCount ? Number(values.copiesCount) : 1,
        condition: values.condition || 'Baik',
        inventoryCode: values.inventoryCode.trim(),
        copyNotes: values.copyNotes.trim(),
        isReferenceOnly: values.isReferenceOnly,
        readInPlaceOnly: values.isReferenceOnly || values.readInPlaceOnly,
        isFeatured: values.isFeatured,
      };

      const res = await gatewayFetch(
        editingBook ? `/api/books/${editingBook.id}` : '/api/books',
        {
          method: editingBook ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan data buku.');

      showToast(
        'success',
        editingBook ? 'Data buku diperbarui' : 'Buku baru tersimpan',
        `${values.title.trim()}${!editingBook ? ` (${payload.copiesCount} eksemplar)` : ''}`
      );
      onSaved();
      onClose();
    } catch (err) {
      showToast(
        'error',
        'Gagal menyimpan buku',
        err instanceof Error ? err.message : 'Terjadi kesalahan saat menyimpan data.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Top Section Jump Bar + Completeness Progress */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {SECTIONS.map((sec) => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => jumpToSection(sec.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#222B3A] text-white'
                      : 'bg-[#FAF9F5] text-[#4A4945] border border-[#E2DFD7] hover:bg-[#EFECE3]'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span>{sec.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#5C5E64] shrink-0">
            <span>Kelengkapan:</span>
            <span className="font-mono font-semibold text-[#1E2433] tabular-nums">
              {completeness.filled}/{completeness.total} ({completeness.percent}%)
            </span>
          </div>
        </div>

        {/* Main 2-Column Split: Left Form Sections (8 cols) + Right Live Preview (4 cols) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT: Comprehensive 5-Section Form */}
          <div className="space-y-6 lg:col-span-8">
            {/* SECTION 1: Sampul (Link URL) & Identitas Judul */}
            <section
              id="sec-identitas"
              onFocus={() => setActiveSection('sec-identitas')}
              className="space-y-4 rounded-xl border border-[#E7E4DC] bg-white p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 border-b border-[#EFECE3] pb-2.5">
                <ImageIcon className="h-4 w-4 text-[#E56B63]" />
                <div>
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    1. Link Cover & Identitas Judul
                  </h3>
                  <p className="text-[11px] text-[#7B7D82]">
                    Tempel tautan URL gambar sampul buku secara langsung tanpa perlu unggah berkas.
                  </p>
                </div>
              </div>

              {/* Cover URL Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="book-cover-url" className="text-xs font-medium text-[#4A4945]">
                    Link Cover Buku (URL Gambar)
                  </label>
                  {values.coverUrl && (
                    <button
                      type="button"
                      onClick={() => setField('coverUrl', '')}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#C94A43] hover:underline cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                      Hapus link
                    </button>
                  )}
                </div>
                <div className="relative flex items-center">
                  <Link2 className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#8A8B90]" />
                  <input
                    id="book-cover-url"
                    name="coverUrl"
                    type="url"
                    value={values.coverUrl}
                    onChange={(e) => setField('coverUrl', e.target.value)}
                    placeholder="https://contoh.com/gambar-cover-buku.jpg"
                    className={`h-10 w-full rounded-xl border bg-white pl-10 pr-3.5 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10 ${
                      errors.coverUrl || !coverUrlValidation.valid
                        ? 'border-[#C94A43]'
                        : 'border-[#E2DFD7]'
                    }`}
                  />
                </div>
                {(errors.coverUrl || !coverUrlValidation.valid) && (
                  <p className="text-xs text-[#C94A43]">
                    {errors.coverUrl || coverUrlValidation.reason}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-[#7B7D82]">
                  <span>Preset sampul SD:</span>
                  {PRESET_COVER_LINKS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setField('coverUrl', preset.url)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                        values.coverUrl === preset.url
                          ? 'border-[#222B3A] bg-[#222B3A] text-white'
                          : 'border-[#E2DFD7] bg-[#FAF9F5] text-[#4A4945] hover:bg-[#EFECE3]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <TextField
                label="Judul Utama Buku *"
                name="title"
                value={values.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="Contoh: Petualangan Sains Anak Nusantara"
                error={errors.title}
                required
              />

              <TextField
                label="Subjudul / Anak Judul"
                name="subtitle"
                value={values.subtitle}
                onChange={(e) => setField('subtitle', e.target.value)}
                placeholder="Contoh: 25 Eksperimen Seru di Rumah dan Sekolah"
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Nama Seri / Koleksi"
                  name="seriesName"
                  value={values.seriesName}
                  onChange={(e) => setField('seriesName', e.target.value)}
                  placeholder="Contoh: Seri Penjelajah Cilik"
                />
                <TextField
                  label="Volume / Jilid / Nomor Seri"
                  name="volume"
                  value={values.volume}
                  onChange={(e) => setField('volume', e.target.value)}
                  placeholder="Contoh: Jilid 1 / Vol. 2"
                />
              </div>
            </section>

            {/* SECTION 2: Kepengarangan & Penerbitan */}
            <section
              id="sec-pengarang"
              onFocus={() => setActiveSection('sec-pengarang')}
              className="space-y-4 rounded-xl border border-[#E7E4DC] bg-white p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 border-b border-[#EFECE3] pb-2.5">
                <UserPen className="h-4 w-4 text-[#E56B63]" />
                <div>
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    2. Kepengarangan & Informasi Penerbitan
                  </h3>
                  <p className="text-[11px] text-[#7B7D82]">
                    Catat penulis, ilustrator, editor, penerjemah, serta data impresum penerbit.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Penulis Utama (pisahkan koma) *"
                  name="authors"
                  value={values.authors}
                  onChange={(e) => setField('authors', e.target.value)}
                  placeholder="Contoh: Watiek Ideo, Nindia Maya"
                  error={errors.authors}
                  required
                />
                <TextField
                  label="Ilustrator / Desainer Sampul"
                  name="illustrator"
                  value={values.illustrator}
                  onChange={(e) => setField('illustrator', e.target.value)}
                  placeholder="Contoh: Raka Pratama"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Editor / Penyunting"
                  name="editor"
                  value={values.editor}
                  onChange={(e) => setField('editor', e.target.value)}
                  placeholder="Contoh: Dian Kusuma"
                />
                <TextField
                  label="Penerjemah (jika buku terjemahan)"
                  name="translator"
                  value={values.translator}
                  onChange={(e) => setField('translator', e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Nama Penerbit"
                  name="publisher"
                  value={values.publisher}
                  onChange={(e) => setField('publisher', e.target.value)}
                  placeholder="Contoh: Erlangga for Kids"
                />
                <TextField
                  label="Kota Terbit"
                  name="publishCity"
                  value={values.publishCity}
                  onChange={(e) => setField('publishCity', e.target.value)}
                  placeholder="Contoh: Jakarta / Bandung"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField
                  label="Tahun Terbit"
                  name="publishYear"
                  type="number"
                  min={1900}
                  max={2100}
                  value={values.publishYear}
                  onChange={(e) => setField('publishYear', e.target.value)}
                  error={errors.publishYear}
                />
                <TextField
                  label="Edisi / Cetakan"
                  name="edition"
                  value={values.edition}
                  onChange={(e) => setField('edition', e.target.value)}
                  placeholder="Contoh: Edisi Revisi / Cetakan 2"
                />
                <SelectField
                  label="Bahasa"
                  name="language"
                  value={values.language}
                  onChange={(e) => setField('language', e.target.value)}
                >
                  {BOOK_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </SelectField>
              </div>
            </section>

            {/* SECTION 3: Klasifikasi & Katalog Perpustakaan */}
            <section
              id="sec-klasifikasi"
              onFocus={() => setActiveSection('sec-klasifikasi')}
              className="space-y-4 rounded-xl border border-[#E7E4DC] bg-white p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 border-b border-[#EFECE3] pb-2.5">
                <Hash className="h-4 w-4 text-[#E56B63]" />
                <div>
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    3. Klasifikasi Perpustakaan & Target Pembaca
                  </h3>
                  <p className="text-[11px] text-[#7B7D82]">
                    Nomor ISBN, kode DDC, nomor panggil punggung buku, kategori, dan jenjang kelas.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField
                  label="ISBN-13 / ISBN-10"
                  name="isbn"
                  value={values.isbn}
                  onChange={(e) => setField('isbn', e.target.value)}
                  placeholder="978-602-123-456-7"
                  error={errors.isbn}
                />
                <TextField
                  label="Kode Klasifikasi DDC"
                  name="ddcCode"
                  value={values.ddcCode}
                  onChange={(e) => setField('ddcCode', e.target.value)}
                  placeholder="Contoh: 500 / 813 / 398.2"
                />
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="field-call-number" className="text-xs font-medium text-[#4A4945]">
                      Nomor Panggil
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoCallNumber}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E56B63] hover:underline cursor-pointer whitespace-nowrap"
                    >
                      <Sparkles className="h-3 w-3" />
                      Auto Susun
                    </button>
                  </div>
                  <input
                    id="field-call-number"
                    name="callNumber"
                    value={values.callNumber}
                    onChange={(e) => setField('callNumber', e.target.value)}
                    placeholder="Contoh: 500 IDE p"
                    className="h-10 rounded-xl border border-[#E2DFD7] bg-white px-3.5 font-mono text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Kategori Utama"
                  name="categoryId"
                  value={values.categoryId}
                  onChange={(e) => setField('categoryId', e.target.value)}
                >
                  <option value="">Pilih Kategori</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Subkategori / Genre"
                  name="subcategory"
                  value={values.subcategory}
                  onChange={(e) => setField('subcategory', e.target.value)}
                  placeholder="Contoh: Fabel Nusantara / Eksperimen IPA"
                />
              </div>

              <TextField
                label="Subjek / Kata Kunci Pencarian (pisahkan koma)"
                name="subjects"
                value={values.subjects}
                onChange={(e) => setField('subjects', e.target.value)}
                placeholder="Contoh: sains anak, tata surya, eksperimen air, literasi kelas 4"
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField
                  label="Target Jenjang / Kelas"
                  name="targetGrade"
                  value={values.targetGrade}
                  onChange={(e) => setField('targetGrade', e.target.value)}
                >
                  {BOOK_TARGET_GRADES.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Rekomendasi Rentang Usia"
                  name="ageRange"
                  value={values.ageRange}
                  onChange={(e) => setField('ageRange', e.target.value)}
                  placeholder="Contoh: 7–10 tahun"
                />
              </div>
            </section>

            {/* SECTION 4: Spesifikasi Fisik & Konten */}
            <section
              id="sec-fisik"
              onFocus={() => setActiveSection('sec-fisik')}
              className="space-y-4 rounded-xl border border-[#E7E4DC] bg-white p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 border-b border-[#EFECE3] pb-2.5">
                <Layers className="h-4 w-4 text-[#E56B63]" />
                <div>
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    4. Spesifikasi Fisik & Deskripsi Konten
                  </h3>
                  <p className="text-[11px] text-[#7B7D82]">
                    Detail kolasi fisik buku, sinopsis untuk pembaca, serta daftar isi atau catatan kurikulum.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <TextField
                  label="Jumlah Halaman"
                  name="pages"
                  type="number"
                  min={1}
                  max={10000}
                  value={values.pages}
                  onChange={(e) => setField('pages', e.target.value)}
                  error={errors.pages}
                />
                <TextField
                  label="Dimensi Fisik (L × T)"
                  name="dimensions"
                  value={values.dimensions}
                  onChange={(e) => setField('dimensions', e.target.value)}
                  placeholder="Contoh: 17 × 24 cm"
                />
                <TextField
                  label="Berat Buku (gram)"
                  name="weightGrams"
                  type="number"
                  min={0}
                  max={20000}
                  value={values.weightGrams}
                  onChange={(e) => setField('weightGrams', e.target.value)}
                  placeholder="Contoh: 280"
                  error={errors.weightGrams}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SelectField
                  label="Jenis Sampul / Jilid"
                  name="bindingType"
                  value={values.bindingType}
                  onChange={(e) => setField('bindingType', e.target.value)}
                >
                  {BOOK_BINDING_TYPES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Jenis Kertas Isi"
                  name="paperType"
                  value={values.paperType}
                  onChange={(e) => setField('paperType', e.target.value)}
                >
                  <option value="">Pilih Jenis Kertas</option>
                  {BOOK_PAPER_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Catatan Ilustrasi"
                  name="illustrationNotes"
                  value={values.illustrationNotes}
                  onChange={(e) => setField('illustrationNotes', e.target.value)}
                  placeholder="Contoh: Full Color, ilustrasi cat air"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="book-description" className="text-xs font-medium text-[#4A4945]">
                    Sinopsis / Deskripsi Ringkas
                  </label>
                  <span className="font-mono text-[11px] text-[#8A8B90] tabular-nums">
                    {values.description.length}/2000
                  </span>
                </div>
                <textarea
                  id="book-description"
                  name="description"
                  rows={3}
                  value={values.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="Tuliskan ringkasan isi buku yang menarik untuk membantu siswa dan guru memilih bacaan..."
                  className="rounded-xl border border-[#E2DFD7] bg-white p-3 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
                />
                {errors.description && <p className="text-xs text-[#C94A43]">{errors.description}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="book-toc" className="text-xs font-medium text-[#4A4945]">
                    Daftar Isi / Poin Materi / Catatan Kurikulum
                  </label>
                  <span className="font-mono text-[11px] text-[#8A8B90] tabular-nums">
                    {values.tableOfContents.length}/2000
                  </span>
                </div>
                <textarea
                  id="book-toc"
                  name="tableOfContents"
                  rows={3}
                  value={values.tableOfContents}
                  onChange={(e) => setField('tableOfContents', e.target.value)}
                  placeholder="Contoh: Bab 1 Mengenal Air · Bab 2 Cahaya dan Pelangi · Bab 3 Magnet di Sekitar Kita..."
                  className="rounded-xl border border-[#E2DFD7] bg-white p-3 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
                />
                {errors.tableOfContents && (
                  <p className="text-xs text-[#C94A43]">{errors.tableOfContents}</p>
                )}
              </div>
            </section>

            {/* SECTION 5: Perolehan, Inventaris Eksemplar & Kebijakan Sirkulasi */}
            <section
              id="sec-inventaris"
              onFocus={() => setActiveSection('sec-inventaris')}
              className="space-y-4 rounded-xl border border-[#E7E4DC] bg-white p-4 sm:p-5"
            >
              <div className="flex items-center gap-2 border-b border-[#EFECE3] pb-2.5">
                <Package className="h-4 w-4 text-[#E56B63]" />
                <div>
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    5. Perolehan, Inventaris Awal & Kebijakan Sirkulasi
                  </h3>
                  <p className="text-[11px] text-[#7B7D82]">
                    Asal pengadaan, nilai aset buku, aturan peminjaman, dan penempatan rak eksemplar.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SelectField
                  label="Sumber Perolehan"
                  name="acquisitionSource"
                  value={values.acquisitionSource}
                  onChange={(e) => setField('acquisitionSource', e.target.value)}
                >
                  {BOOK_ACQUISITION_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="Tanggal Perolehan"
                  name="acquisitionDate"
                  type="date"
                  value={values.acquisitionDate}
                  onChange={(e) => setField('acquisitionDate', e.target.value)}
                />
                <TextField
                  label="Harga / Nilai Aset (Rp)"
                  name="price"
                  type="number"
                  min={0}
                  value={values.price}
                  onChange={(e) => setField('price', e.target.value)}
                  error={errors.price}
                />
              </div>

              {!editingBook && (
                <div className="space-y-4 rounded-xl border border-[#EFECE3] bg-[#FAF9F5] p-3.5">
                  <p className="text-xs font-semibold text-[#1E2433]">
                    Pengaturan Eksemplar Fisik Awal
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <SelectField
                      label="Lokasi Rak Awal"
                      name="shelfId"
                      value={values.shelfId}
                      onChange={(e) => setField('shelfId', e.target.value)}
                    >
                      <option value="">Pilih Rak</option>
                      {shelves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </SelectField>
                    <TextField
                      label="Jumlah Eksemplar (1–50)"
                      name="copiesCount"
                      type="number"
                      min={1}
                      max={50}
                      value={values.copiesCount}
                      onChange={(e) => setField('copiesCount', e.target.value)}
                      error={errors.copiesCount}
                    />
                    <SelectField
                      label="Kondisi Awal"
                      name="condition"
                      value={values.condition}
                      onChange={(e) => setField('condition', e.target.value)}
                    >
                      {BOOK_COPY_CONDITIONS.map((cond) => (
                        <option key={cond} value={cond}>
                          {cond}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      label="Kode Inventaris Kustom (opsional, untuk 1 eks)"
                      name="inventoryCode"
                      value={values.inventoryCode}
                      onChange={(e) => setField('inventoryCode', e.target.value)}
                      placeholder="Kosongkan untuk generate otomatis LP-2026-xxxx"
                    />
                    <TextField
                      label="Catatan Fisik Eksemplar"
                      name="copyNotes"
                      value={values.copyNotes}
                      onChange={(e) => setField('copyNotes', e.target.value)}
                      placeholder="Contoh: Sudah disampul plastik mika & distempel"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2.5 pt-1">
                <label className="flex items-start gap-2.5 text-xs text-[#4A4945] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={values.isReferenceOnly}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setField('isReferenceOnly', checked);
                      if (checked) setField('readInPlaceOnly', true);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-[#DFDCD4]"
                  />
                  <span>
                    <strong className="font-medium text-[#1E2433]">Koleksi Referensi</strong> —
                    Khusus rujukan di ruang perpustakaan dan tidak dapat dipinjam pulang.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-[#4A4945] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={values.readInPlaceOnly}
                    disabled={values.isReferenceOnly}
                    onChange={(e) => setField('readInPlaceOnly', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#DFDCD4]"
                  />
                  <span>
                    <strong className="font-medium text-[#1E2433]">Baca di Tempat Saja</strong> —
                    Siswa dapat membaca di ruang baca tanpa transaksi pinjam keluar.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-[#4A4945] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={values.isFeatured}
                    onChange={(e) => setField('isFeatured', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#DFDCD4]"
                  />
                  <span>
                    <strong className="font-medium text-[#1E2433]">Tandai Buku Unggulan</strong> —
                    Sorot koleksi ini sebagai rekomendasi bacaan pilihan pustakawan.
                  </span>
                </label>
              </div>
            </section>
          </div>

          {/* RIGHT: Sticky Live Cover & Catalog Card Preview */}
          <aside className="lg:col-span-4">
            <div className="sticky top-2 space-y-4 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#1E2433]">Pratinjau Sampul & Katalog</span>
                {values.coverUrl && coverUrlValidation.valid && (
                  <a
                    href={values.coverUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5C5E64] hover:text-[#1E2433]"
                  >
                    Buka link
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {/* 2:3 Cover Preview */}
              <div className="mx-auto w-36 sm:w-40">
                <BookCoverThumb
                  src={coverUrlValidation.valid ? values.coverUrl : ''}
                  title={values.title || 'Judul Buku'}
                  size="lg"
                  onStatusChange={setCoverStatus}
                  className="aspect-[2/3] w-full rounded-lg border border-[#DCD8CE] shadow-md"
                />
              </div>

              {/* Cover Status Feedback */}
              <div className="flex items-center justify-center gap-1.5 text-xs">
                {!values.coverUrl.trim() ? (
                  <span className="inline-flex items-center gap-1.5 text-[#7B7D82]">
                    <BookOpen className="h-3.5 w-3.5" />
                    Belum ada link cover diisi
                  </span>
                ) : !coverUrlValidation.valid ? (
                  <span className="inline-flex items-center gap-1.5 text-[#C94A43]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Format URL link tidak valid
                  </span>
                ) : coverStatus === 'loaded' ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Cover dari link berhasil dimuat
                  </span>
                ) : coverStatus === 'error' ? (
                  <span className="inline-flex items-center gap-1.5 text-[#C94A43]">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Gambar tidak dapat dimuat dari link
                  </span>
                ) : (
                  <span className="text-[#5C5E64]">Memuat pratinjau sampul...</span>
                )}
              </div>

              {/* Live Catalog Summary */}
              <div className="space-y-2.5 border-t border-[#E2DFD7] pt-3.5 text-xs">
                <div>
                  <p className="font-serif text-base font-semibold leading-snug text-[#1E2433] line-clamp-2">
                    {values.title.trim() || 'Judul Buku Belum Diisi'}
                  </p>
                  {values.subtitle.trim() && (
                    <p className="mt-0.5 text-xs text-[#5C5E64] line-clamp-2">
                      {values.subtitle.trim()}
                    </p>
                  )}
                  <p className="mt-1 text-xs italic text-[#7B7D82] truncate">
                    {values.authors.trim() || 'Nama penulis belum diisi'}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#E7E4DC] pt-3 text-[11px]">
                  <div>
                    <dt className="text-[#7B7D82]">Kategori</dt>
                    <dd className="truncate font-medium text-[#1E2433]">{selectedCategoryName}</dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">Target Kelas</dt>
                    <dd className="truncate font-medium text-[#1E2433]">
                      {values.targetGrade || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">DDC / Panggil</dt>
                    <dd className="truncate font-mono text-[#1E2433]">
                      {values.callNumber || values.ddcCode || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">ISBN</dt>
                    <dd className="truncate font-mono text-[#1E2433]">{values.isbn || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">Fisik</dt>
                    <dd className="truncate text-[#1E2433] tabular-nums">
                      {values.pages ? `${values.pages} hlm` : '-'}
                      {values.dimensions ? ` · ${values.dimensions}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">Nilai Aset</dt>
                    <dd className="truncate font-mono font-medium text-[#1E2433] tabular-nums">
                      {formatCurrencyIDR(Number(values.price || 0))}
                    </dd>
                  </div>
                </dl>

                {!editingBook && (
                  <div className="border-t border-[#E7E4DC] pt-2.5 text-[11px] text-[#5C5E64]">
                    <span className="font-medium text-[#1E2433]">Penempatan Awal: </span>
                    <span className="tabular-nums">
                      {values.copiesCount || 1} eks ({values.condition}) · {selectedShelfLabel}
                    </span>
                  </div>
                )}

                {(values.isReferenceOnly || values.readInPlaceOnly || values.isFeatured) && (
                  <p className="border-t border-[#E7E4DC] pt-2 text-[11px] font-medium text-[#E56B63]">
                    {[
                      values.isFeatured ? 'Unggulan' : '',
                      values.isReferenceOnly ? 'Referensi' : '',
                      !values.isReferenceOnly && values.readInPlaceOnly ? 'Baca di Tempat' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Sticky Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E7E4DC] pt-4">
          <p className="text-xs text-[#7B7D82]">
            Kolom bertanda <span className="font-semibold text-[#1E2433]">*</span> wajib diisi.
            Link cover mendukung semua URL gambar <span className="font-mono">https://</span>.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              {editingBook ? 'Simpan Perubahan Katalog' : 'Simpan Buku ke Katalog'}
            </Button>
          </div>
        </div>
      </form>
  );
}
