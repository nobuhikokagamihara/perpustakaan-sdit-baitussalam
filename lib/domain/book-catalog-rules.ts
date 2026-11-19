export const BOOK_LANGUAGES = [
  'Indonesia',
  'Inggris',
  'Bilingual (Indonesia-Inggris)',
  'Bahasa Daerah',
  'Arab',
  'Mandarin',
  'Lainnya',
] as const;

export const BOOK_TARGET_GRADES = [
  'Semua Kelas (1–6 SD)',
  'Kelas Rendah (1–3 SD)',
  'Kelas Tinggi (4–6 SD)',
  'Kelas 1 SD',
  'Kelas 2 SD',
  'Kelas 3 SD',
  'Kelas 4 SD',
  'Kelas 5 SD',
  'Kelas 6 SD',
  'Guru & Pendidik',
  'Umum / Orang Tua',
] as const;

export const BOOK_BINDING_TYPES = [
  'Softcover (Art Carton)',
  'Hardcover',
  'Board Book',
  'Jilid Kawat / Booklet',
  'Spiral',
  'Lainnya',
] as const;

export const BOOK_PAPER_TYPES = [
  'HVS 70/80 gsm',
  'Art Paper (Glossy)',
  'Matte Paper',
  'Bookpaper',
  'Board Tebal (Ivory)',
  'Kertas Koran / Buram',
] as const;

export const BOOK_ACQUISITION_SOURCES = [
  'Pembelian Dana BOS',
  'Anggaran Sekolah',
  'Hibah / Donasi',
  'Bantuan Dinas Pendidikan',
  'Hadiah / Lomba',
  'Tukar Menukar',
] as const;

export const BOOK_COPY_CONDITIONS = [
  'Baik',
  'Rusak Ringan',
  'Rusak Berat',
] as const;

export const PRESET_COVER_LINKS = [
  { label: 'Cerita Anak', url: '/images/cover-cerita-anak.jpg' },
  { label: 'Sains SD', url: '/images/cover-sains-sd.jpg' },
  { label: 'Pelajaran SD', url: '/images/cover-pelajaran-sd.jpg' },
  { label: 'Budaya Nusantara', url: '/images/cover-budaya-sd.jpg' },
] as const;

export interface BookFormValues {
  title: string;
  subtitle: string;
  seriesName: string;
  volume: string;
  coverUrl: string;
  authors: string;
  illustrator: string;
  editor: string;
  translator: string;
  publisher: string;
  publishCity: string;
  publishYear: string;
  edition: string;
  language: string;
  isbn: string;
  ddcCode: string;
  callNumber: string;
  categoryId: string;
  subcategory: string;
  subjects: string;
  targetGrade: string;
  ageRange: string;
  pages: string;
  dimensions: string;
  bindingType: string;
  paperType: string;
  weightGrams: string;
  illustrationNotes: string;
  description: string;
  tableOfContents: string;
  acquisitionSource: string;
  acquisitionDate: string;
  price: string;
  shelfId: string;
  copiesCount: string;
  condition: string;
  inventoryCode: string;
  copyNotes: string;
  isReferenceOnly: boolean;
  readInPlaceOnly: boolean;
  isFeatured: boolean;
}

export interface BookValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateCoverUrl(rawUrl: string): { valid: boolean; reason?: string; normalized: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }
  if (trimmed.length > 1000) {
    return { valid: false, reason: 'Link cover terlalu panjang (maksimal 1000 karakter).', normalized: trimmed };
  }

  // Allow relative local paths under /images/ or /assets/
  if (trimmed.startsWith('/')) {
    if (/^\/[a-zA-Z0-9_\-./%]+$/.test(trimmed) && !trimmed.includes('..')) {
      return { valid: true, normalized: trimmed };
    }
    return { valid: false, reason: 'Path cover lokal tidak valid.', normalized: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        reason: 'Link cover harus diawali http:// atau https:// (atau path lokal /images/...).',
        normalized: trimmed,
      };
    }
    if (!parsed.hostname || (parsed.hostname !== 'localhost' && !parsed.hostname.includes('.'))) {
      return {
        valid: false,
        reason: 'Domain pada link cover tidak valid.',
        normalized: trimmed,
      };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return {
      valid: false,
      reason: 'Format URL link cover tidak valid. Contoh: https://contoh.com/cover.jpg',
      normalized: trimmed,
    };
  }
}

export function validateIsbnFormat(rawIsbn: string): { valid: boolean; reason?: string; normalized: string } {
  const trimmed = String(rawIsbn || '').trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }
  if (trimmed.length > 40) {
    return { valid: false, reason: 'ISBN maksimal 40 karakter.', normalized: trimmed };
  }
  const compact = trimmed.replace(/[-\s]/g, '').toUpperCase();
  const isIsbn10 = /^\d{9}[\dX]$/.test(compact);
  const isIsbn13 = /^(978|979)\d{10}$/.test(compact);
  if (!isIsbn10 && !isIsbn13) {
    return {
      valid: false,
      reason: 'Format ISBN harus 10 digit atau 13 digit (diawali 978/979), contoh: 978-602-123-456-7.',
      normalized: trimmed,
    };
  }
  return { valid: true, normalized: trimmed };
}

const STOP_WORDS_ID_EN = new Set(['di', 'ke', 'dari', 'dan', 'yang', 'the', 'a', 'an', 'of', 'si', 'sang']);

export function generateCallNumber(input: {
  ddcCode?: string;
  authors?: string;
  title?: string;
}): string {
  const ddc = String(input.ddcCode || '').trim().replace(/\s+/g, '') || '000';
  const firstAuthor = String(input.authors || '')
    .split(',')[0]
    .trim();

  // Standard AACR2 / Indonesian cataloging uses first 3 letters of author's entry word (last word for personal names, skipping titles like "Dr.", "Kak")
  const cleanedAuthorWords = firstAuthor
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['dr', 'prof', 'hj', 'ir', 'drs', 'kak', 'pak', 'ibu', 'tim'].includes(w.toLowerCase()));
  const authorAnchor = cleanedAuthorWords.length > 0 ? cleanedAuthorWords[cleanedAuthorWords.length - 1] : 'ANO';
  const authorCode = authorAnchor.slice(0, 3).toUpperCase();

  const titleWords = String(input.title || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const significantTitleWord =
    titleWords.find((w) => !STOP_WORDS_ID_EN.has(w.toLowerCase())) || titleWords[0] || 'a';
  const titleInitial = significantTitleWord[0].toLowerCase();

  return `${ddc} ${authorCode} ${titleInitial}`;
}

export function validateBookFormInput(
  input: Partial<BookFormValues>,
  options: { isEditing?: boolean } = {}
): BookValidationResult {
  const errors: Record<string, string> = {};

  const title = String(input.title || '').trim();
  if (!title) {
    errors.title = 'Judul buku wajib diisi.';
  } else if (title.length > 240) {
    errors.title = 'Judul buku maksimal 240 karakter.';
  }

  const authors = String(input.authors || '').trim();
  if (!authors) {
    errors.authors = 'Minimal satu nama penulis wajib diisi.';
  } else if (authors.length > 200) {
    errors.authors = 'Daftar penulis maksimal 200 karakter.';
  }

  const coverCheck = validateCoverUrl(String(input.coverUrl || ''));
  if (!coverCheck.valid && coverCheck.reason) {
    errors.coverUrl = coverCheck.reason;
  }

  const isbnCheck = validateIsbnFormat(String(input.isbn || ''));
  if (!isbnCheck.valid && isbnCheck.reason) {
    errors.isbn = isbnCheck.reason;
  }

  const year = Number(input.publishYear);
  if (input.publishYear !== undefined && String(input.publishYear).trim() !== '') {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      errors.publishYear = 'Tahun terbit harus antara 1900 hingga 2100.';
    }
  }

  const pages = Number(input.pages);
  if (input.pages !== undefined && String(input.pages).trim() !== '') {
    if (!Number.isFinite(pages) || pages < 1 || pages > 10000) {
      errors.pages = 'Jumlah halaman harus antara 1 hingga 10.000.';
    }
  }

  const price = Number(input.price);
  if (input.price !== undefined && String(input.price).trim() !== '') {
    if (!Number.isFinite(price) || price < 0 || price > 100_000_000) {
      errors.price = 'Harga / nilai buku tidak valid.';
    }
  }

  const weight = Number(input.weightGrams || 0);
  if (input.weightGrams !== undefined && String(input.weightGrams).trim() !== '') {
    if (!Number.isFinite(weight) || weight < 0 || weight > 20000) {
      errors.weightGrams = 'Berat buku harus antara 0 hingga 20.000 gram.';
    }
  }

  if (!options.isEditing) {
    const copies = Number(input.copiesCount);
    if (!Number.isInteger(copies) || copies < 1 || copies > 50) {
      errors.copiesCount = 'Jumlah eksemplar awal harus antara 1 hingga 50.';
    }
  }

  if (String(input.description || '').length > 2000) {
    errors.description = 'Sinopsis maksimal 2000 karakter.';
  }
  if (String(input.tableOfContents || '').length > 2000) {
    errors.tableOfContents = 'Daftar isi maksimal 2000 karakter.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function computeCatalogCompleteness(values: BookFormValues): {
  filled: number;
  total: number;
  percent: number;
} {
  const checkpoints: boolean[] = [
    Boolean(values.title.trim()),
    Boolean(values.coverUrl.trim()),
    Boolean(values.authors.trim()),
    Boolean(values.publisher.trim()),
    Boolean(values.publishYear.trim()),
    Boolean(values.publishCity.trim()),
    Boolean(values.isbn.trim()),
    Boolean(values.ddcCode.trim()),
    Boolean(values.callNumber.trim()),
    Boolean(values.categoryId.trim()),
    Boolean(values.subjects.trim()),
    Boolean(values.targetGrade.trim()),
    Boolean(values.pages.trim()),
    Boolean(values.dimensions.trim()),
    Boolean(values.bindingType.trim()),
    Boolean(values.description.trim()),
    Boolean(values.price.trim()),
    Boolean(values.acquisitionSource.trim()),
  ];
  const filled = checkpoints.filter(Boolean).length;
  const total = checkpoints.length;
  return {
    filled,
    total,
    percent: Math.round((filled / total) * 100),
  };
}

export function clampText(val: unknown, maxLen: number, fallback = ''): string {
  const s = String(val ?? '').trim();
  if (!s) return fallback;
  return s.slice(0, maxLen);
}
