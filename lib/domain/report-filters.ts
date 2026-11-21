import { extractGradeLevel, parseRombelParts } from './reading-schedule-rules';

export type ReportClassFilterMode =
  | 'member_class'
  | 'class_borrowing'
  | 'grade_suitability'
  | 'class_roster'
  | 'copy_class_activity'
  | 'acquisition_scope';

export interface ReportTypeDefinition {
  value: string;
  label: string;
  classFilterMode: ReportClassFilterMode;
  supportsCategoryFilter: boolean;
  isCirculationReport: boolean;
}

export const REPORT_TYPES: readonly ReportTypeDefinition[] = [
  {
    value: 'circulation',
    label: 'Laporan Sirkulasi (Pinjam & Kembali)',
    classFilterMode: 'member_class',
    supportsCategoryFilter: true,
    isCirculationReport: true,
  },
  {
    value: 'loans',
    label: 'Laporan Peminjaman',
    classFilterMode: 'member_class',
    supportsCategoryFilter: true,
    isCirculationReport: true,
  },
  {
    value: 'returns',
    label: 'Laporan Pengembalian',
    classFilterMode: 'member_class',
    supportsCategoryFilter: true,
    isCirculationReport: true,
  },
  {
    value: 'overdue',
    label: 'Laporan Keterlambatan',
    classFilterMode: 'member_class',
    supportsCategoryFilter: true,
    isCirculationReport: true,
  },
  {
    value: 'collection',
    label: 'Laporan Koleksi Buku',
    classFilterMode: 'grade_suitability',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'available',
    label: 'Laporan Buku Tersedia',
    classFilterMode: 'grade_suitability',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'active_members',
    label: 'Laporan Anggota Aktif',
    classFilterMode: 'member_class',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
  {
    value: 'most_active_members',
    label: 'Laporan Anggota Paling Aktif',
    classFilterMode: 'member_class',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
  {
    value: 'popular_books',
    label: 'Laporan Buku Paling Populer',
    classFilterMode: 'class_borrowing',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'popular_categories',
    label: 'Laporan Kategori Paling Diminati',
    classFilterMode: 'class_borrowing',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'fines',
    label: 'Laporan Denda',
    classFilterMode: 'member_class',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
  {
    value: 'payments',
    label: 'Laporan Pembayaran',
    classFilterMode: 'member_class',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
  {
    value: 'acquisitions',
    label: 'Laporan Pengadaan',
    classFilterMode: 'acquisition_scope',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
  {
    value: 'inventory',
    label: 'Laporan Inventaris',
    classFilterMode: 'grade_suitability',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'lost_damaged',
    label: 'Laporan Buku Hilang & Rusak',
    classFilterMode: 'copy_class_activity',
    supportsCategoryFilter: true,
    isCirculationReport: false,
  },
  {
    value: 'class_rosters',
    label: 'Laporan Rombel & Literasi Kelas',
    classFilterMode: 'class_roster',
    supportsCategoryFilter: false,
    isCirculationReport: false,
  },
] as const;

export function normalizeClassFilter(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}

export function normalizeCategoryName(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export function normalizeClassKey(raw: string | null | undefined): string {
  return normalizeClassFilter(raw).toLowerCase();
}

export function matchesExactClass(
  unitOrClass: string | null | undefined,
  selectedClass: string | null | undefined
): boolean {
  const filterKey = normalizeClassKey(selectedClass);
  if (!filterKey) return true;
  return normalizeClassKey(unitOrClass) === filterKey;
}

export function extractGradeFromClassFilter(selectedClass: string | null | undefined): number | null {
  const cleaned = normalizeClassFilter(selectedClass);
  if (!cleaned) return null;
  const parsed = parseRombelParts(cleaned);
  if (parsed) return parsed.gradeLevel;
  const match = /\bkelas\s*([1-6])(?:\b|[a-z])/i.exec(cleaned);
  if (match) return Number(match[1]);
  return null;
}

/**
 * Checks whether a book's target_grade (e.g., "Semua Kelas (1–6 SD)", "Kelas Rendah (1–3 SD)",
 * "Kelas Tinggi (4–6 SD)", "Kelas 5 SD", "Guru & Pendidik") applies to a given Rombel/Kelas filter.
 */
export function doesTargetGradeMatchClass(
  targetGrade: string | null | undefined,
  selectedClass: string | null | undefined
): boolean {
  const filterClean = normalizeClassFilter(selectedClass);
  if (!filterClean) return true;

  const gradeText = String(targetGrade || '').trim();
  const gradeLower = gradeText.toLowerCase();
  const filterLower = filterClean.toLowerCase();

  // Direct text match (e.g. custom target grade or exact unit)
  if (gradeLower && gradeLower === filterLower) return true;

  // Non-rombel unit filters (e.g. Guru / Wali Kelas / Komite / Staf)
  const gradeLevel = extractGradeFromClassFilter(filterClean);
  if (gradeLevel === null) {
    if (!gradeLower || gradeLower.includes('semua kelas')) return true;
    if (filterLower.includes('guru') || filterLower.includes('wali')) {
      return gradeLower.includes('guru') || gradeLower.includes('pendidik') || gradeLower.includes('semua');
    }
    if (filterLower.includes('komite') || filterLower.includes('orang tua')) {
      return gradeLower.includes('umum') || gradeLower.includes('orang tua') || gradeLower.includes('semua');
    }
    return gradeLower.includes(filterLower);
  }

  // Standard SD grade 1..6 matching
  if (!gradeLower || gradeLower.includes('semua kelas') || gradeLower.includes('1–6') || gradeLower.includes('1-6')) {
    return true;
  }

  if (gradeLower.includes('kelas rendah') || gradeLower.includes('1–3') || gradeLower.includes('1-3')) {
    return gradeLevel >= 1 && gradeLevel <= 3;
  }

  if (gradeLower.includes('kelas tinggi') || gradeLower.includes('4–6') || gradeLower.includes('4-6')) {
    return gradeLevel >= 4 && gradeLevel <= 6;
  }

  // Explicit range like "Kelas 2–4 SD" or "2-4"
  const rangeMatch = /(\d)\s*[–\-]\s*(\d)/.exec(gradeText);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start >= 1 && end <= 6 && start <= end) {
      return gradeLevel >= start && gradeLevel <= end;
    }
  }

  // Specific single grade like "Kelas 4 SD"
  const singleMatch = /\bkelas\s*([1-6])\b/i.exec(gradeText);
  if (singleMatch) {
    return Number(singleMatch[1]) === gradeLevel;
  }

  return false;
}

/**
 * Checks whether an acquisition proposal (title_summary + notes + item titles) targets a given Rombel/Kelas
 * or its grade level (e.g. "Kelas 1–3", "kelas 4–6", "Kelas 5A", "Kelas 5").
 */
export function doesAcquisitionTextMatchClass(
  fields: { titleSummary?: string | null; notes?: string | null; itemTitles?: ReadonlyArray<string> },
  selectedClass: string | null | undefined
): boolean {
  const filterClean = normalizeClassFilter(selectedClass);
  if (!filterClean) return true;

  const combined = [
    String(fields.titleSummary || ''),
    String(fields.notes || ''),
    ...(fields.itemTitles || []).map((t) => String(t || '')),
  ]
    .join(' ')
    .trim();

  if (!combined) return false;
  const combinedLower = combined.toLowerCase();
  const filterLower = filterClean.toLowerCase();

  // Direct mention of exact rombel (e.g. "Kelas 5A")
  if (combinedLower.includes(filterLower)) return true;

  const gradeLevel = extractGradeFromClassFilter(filterClean);
  if (gradeLevel === null) return false;

  // Check for "semua kelas" / "1-6" / "1–6"
  if (
    combinedLower.includes('semua kelas') ||
    /kelas\s*1\s*[–\-]\s*6/i.test(combined)
  ) {
    return true;
  }

  // Check for grade ranges mentioned in text (e.g. "Kelas 1–3", "kelas 4-6")
  const rangeRegex = /kelas\s*([1-6])\s*[–\-]\s*([1-6])/gi;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(combined)) !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (gradeLevel >= start && gradeLevel <= end) {
      return true;
    }
  }

  if (combinedLower.includes('kelas rendah') && gradeLevel >= 1 && gradeLevel <= 3) {
    return true;
  }
  if (combinedLower.includes('kelas tinggi') && gradeLevel >= 4 && gradeLevel <= 6) {
    return true;
  }

  // Check for exact grade mention without conflicting section letter (e.g. "Kelas 5 SD" or "Kelas 5,")
  const specificGradeRegex = new RegExp(`\\bkelas\\s*${gradeLevel}(?:\\b|\\s+sd\\b)`, 'i');
  if (specificGradeRegex.test(combined)) {
    return true;
  }

  return false;
}

export function getReportTypeDefinition(type: string): ReportTypeDefinition {
  return (
    REPORT_TYPES.find((r) => r.value === type) || {
      value: type,
      label: 'Laporan',
      classFilterMode: 'member_class',
      supportsCategoryFilter: false,
      isCirculationReport: false,
    }
  );
}

export function isCirculationReportType(type: string): boolean {
  return getReportTypeDefinition(type).isCirculationReport;
}

export function doesReportSupportCategoryFilter(type: string): boolean {
  return getReportTypeDefinition(type).supportsCategoryFilter;
}

export function getReportClassFilterHint(type: string, selectedClass: string): string {
  const cleanClass = normalizeClassFilter(selectedClass);
  if (!cleanClass) return '';

  const def = getReportTypeDefinition(type);
  const grade = extractGradeFromClassFilter(cleanClass);

  switch (def.classFilterMode) {
    case 'member_class':
      return `Menampilkan data khusus anggota rombel ${cleanClass}.`;
    case 'class_borrowing':
      return `Menampilkan peringkat literasi berdasarkan aktivitas peminjaman rombel ${cleanClass}.`;
    case 'class_roster':
      return `Menampilkan rekap rombel, keanggotaan, jadwal baca, kehadiran, dan buku dibaca untuk ${cleanClass}.`;
    case 'grade_suitability':
      return grade !== null
        ? `Menampilkan koleksi/inventaris yang sesuai jenjang Kelas ${grade} (${cleanClass}) atau sedang dipinjam rombel ini.`
        : `Menampilkan koleksi/inventaris yang sesuai kelompok ${cleanClass}.`;
    case 'copy_class_activity':
      return `Menampilkan eksemplar hilang/rusak yang tercatat pada riwayat peminjaman atau pengembalian rombel ${cleanClass}.`;
    case 'acquisition_scope':
      return grade !== null
        ? `Menampilkan usulan pengadaan yang ditujukan untuk jenjang Kelas ${grade} / ${cleanClass}.`
        : `Menampilkan usulan pengadaan yang mencantumkan ${cleanClass}.`;
    default:
      return `Filter rombel aktif: ${cleanClass}.`;
  }
}

export function getReportCategoryFilterHint(type: string, categoryName: string): string {
  const cleanCategory = normalizeCategoryName(categoryName);
  if (!cleanCategory) return '';
  if (!doesReportSupportCategoryFilter(type)) {
    return `Filter kategori buku "${cleanCategory}" hanya berlaku pada laporan sirkulasi & koleksi buku.`;
  }
  if (isCirculationReportType(type)) {
    return `Menampilkan transaksi sirkulasi khusus kategori buku ${cleanCategory}.`;
  }
  return `Menampilkan data koleksi khusus kategori buku ${cleanCategory}.`;
}

export function toSafeFilenameSlug(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function buildReportExportMeta(params: {
  reportType: string;
  reportLabel: string;
  className?: string;
  categoryName?: string;
}): { title: string; baseFilename: string } {
  const cleanClass = normalizeClassFilter(params.className);
  const cleanCategory = normalizeCategoryName(params.categoryName);
  const typeSlug = toSafeFilenameSlug(params.reportType) || 'umum';

  const titleParts: string[] = [];
  const slugParts: string[] = ['laporan', typeSlug];

  if (cleanCategory) {
    titleParts.push(`Kategori: ${cleanCategory}`);
    const catSlug = toSafeFilenameSlug(cleanCategory);
    if (catSlug) slugParts.push(catSlug);
  }
  if (cleanClass) {
    titleParts.push(cleanClass);
    const classSlug = toSafeFilenameSlug(cleanClass);
    if (classSlug) slugParts.push(classSlug);
  }

  return {
    title: titleParts.length > 0 ? `${params.reportLabel} — ${titleParts.join(' · ')}` : params.reportLabel,
    baseFilename: slugParts.join('-'),
  };
}

export function getGradeLevelLabel(className: string): string {
  const parsed = parseRombelParts(className);
  if (parsed) return `Kelas ${parsed.gradeLevel}`;
  const g = extractGradeLevel(className);
  return `Kelas ${g}`;
}

export interface CirculationCategoryBreakdownItem {
  categoryId: number | null;
  categoryName: string;
  total: number;
  borrowed: number;
  returned: number;
  overdue: number;
  totalFine: number;
}

export interface CirculationSummaryStats {
  totalItems: number;
  borrowed: number;
  returned: number;
  overdue: number;
  totalFine: number;
}

export function computeCirculationSummary(
  rows: ReadonlyArray<Record<string, unknown>>
): CirculationSummaryStats {
  let borrowed = 0;
  let returned = 0;
  let overdue = 0;
  let totalFine = 0;

  for (const row of rows) {
    const statusRaw = String(row.Status ?? row.status ?? '').trim().toLowerCase();
    const fineRaw = Number(row.Denda ?? row.fineAmount ?? row.fine_amount ?? 0);
    if (Number.isFinite(fineRaw) && fineRaw > 0) {
      totalFine += fineRaw;
    }

    if (
      statusRaw.includes('terlambat') &&
      !statusRaw.includes('dikembalikan') &&
      !statusRaw.includes('kembali') &&
      !statusRaw.includes('selesai')
    ) {
      overdue += 1;
    } else if (
      statusRaw.includes('kembali') ||
      statusRaw.includes('selesai') ||
      statusRaw.includes('tepat waktu') ||
      statusRaw.includes('rusak') ||
      statusRaw.includes('hilang')
    ) {
      returned += 1;
    } else if (statusRaw.includes('dipinjam') || statusRaw.includes('sebagian')) {
      borrowed += 1;
    } else if (statusRaw.includes('terlambat')) {
      overdue += 1;
    }
  }

  return {
    totalItems: rows.length,
    borrowed,
    returned,
    overdue,
    totalFine,
  };
}

const CURRENCY_COLUMNS = new Set([
  'denda',
  'total_denda',
  'tagihan',
  'dibayar',
  'dibebaskan',
  'nominal',
  'estimasi_biaya',
  'nilai_buku',
  'harga',
]);

const NUMERIC_COLUMNS = new Set([
  'no',
  'jumlah_buku',
  'total_eksemplar',
  'tersedia',
  'dipinjam',
  'dipinjam_rombel',
  'hari_terlambat',
  'total_transaksi',
  'total_dipinjam',
  'jumlah_judul',
  'total_peminjaman',
  'tingkat',
  'siswa_rombel',
  'anggota_perpus',
  'jadwal_aktif',
  'total_sesi',
  'total_hadir',
  'buku_dibaca',
]);

const CENTER_COLUMNS = new Set([
  'no',
  'no_transaksi',
  'no_pengembalian',
  'no_peminjaman',
  'no_anggota',
  'kode_anggota',
  'kode_eksemplar',
  'kode_inventaris',
  'kode',
  'rak',
  'rombel_kelas',
  'rombel',
  'unit_kelas',
  'tanggal_pinjam',
  'jatuh_tempo',
  'tanggal_kembali',
  'tanggal',
  'tanggal_bayar',
  'tanggal_pengajuan',
  'berlaku_hingga',
  'status',
  'kondisi',
  'metode',
]);

const COLUMN_LABEL_MAP: Record<string, string> = {
  No_Transaksi: 'No. Transaksi',
  No_Pengembalian: 'No. Pengembalian',
  No_Peminjaman: 'No. Peminjaman',
  No_Anggota: 'No. Anggota',
  No_Denda: 'No. Denda',
  No_Pembayaran: 'No. Pembayaran',
  No_Pengadaan: 'No. Pengadaan',
  Kode_Anggota: 'Kode Anggota',
  Nama_Anggota: 'Nama Anggota',
  Rombel_Kelas: 'Rombel / Kelas',
  Unit_Kelas: 'Unit / Kelas',
  Judul_Buku: 'Judul Buku',
  Kategori_Buku: 'Kategori Buku',
  Kode_Eksemplar: 'Kode Eksemplar',
  Kode_Inventaris: 'Kode Inventaris',
  Tanggal_Pinjam: 'Tgl. Pinjam',
  Jatuh_Tempo: 'Jatuh Tempo',
  Tanggal_Kembali: 'Tgl. Kembali',
  Tanggal_Bayar: 'Tgl. Bayar',
  Tanggal_Pengajuan: 'Tgl. Pengajuan',
  Hari_Terlambat: 'Terlambat (Hari)',
  Jumlah_Buku: 'Jml. Buku',
  Total_Eksemplar: 'Total Eks.',
  Dipinjam_Rombel: 'Dipinjam Rombel',
  Target_Kelas: 'Target Kelas',
  Total_Transaksi: 'Total Transaksi',
  Total_Dipinjam: 'Total Dipinjam',
  Jumlah_Judul: 'Jml. Judul',
  Total_Peminjaman: 'Total Pinjam',
  Berlaku_Hingga: 'Berlaku Hingga',
  Jenis_Denda: 'Jenis Denda',
  Estimasi_Biaya: 'Estimasi Biaya',
  Nilai_Buku: 'Nilai Buku',
  Wali_Kelas: 'Wali Kelas',
  Guru_Pendamping: 'Guru Pendamping',
  Siswa_Rombel: 'Siswa Rombel',
  Anggota_Perpus: 'Anggota Perpus',
  Jadwal_Aktif: 'Jadwal Aktif',
  Total_Sesi: 'Total Sesi',
  Total_Hadir: 'Total Hadir',
  Buku_Dibaca: 'Buku Dibaca',
};

export function formatReportColumnLabel(colKey: string): string {
  return COLUMN_LABEL_MAP[colKey] || colKey.replace(/_/g, ' ');
}

export function isCurrencyColumn(colKey: string): boolean {
  return CURRENCY_COLUMNS.has(colKey.trim().toLowerCase());
}

export function isNumericColumn(colKey: string): boolean {
  const key = colKey.trim().toLowerCase();
  return CURRENCY_COLUMNS.has(key) || NUMERIC_COLUMNS.has(key);
}

export function getReportColumnAlignment(colKey: string): 'left' | 'center' | 'right' {
  const key = colKey.trim().toLowerCase();
  if (CURRENCY_COLUMNS.has(key) || NUMERIC_COLUMNS.has(key)) return 'right';
  if (CENTER_COLUMNS.has(key)) return 'center';
  return 'left';
}

export function formatRupiahPlain(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(safe));
  return safe < 0 ? `-Rp ${formatted}` : `Rp ${formatted}`;
}

export function formatPdfCellValue(colKey: string, value: unknown): string {
  if (value === null || value === undefined) return '-';
  const str = String(value).trim();
  if (!str) return '-';

  if (isCurrencyColumn(colKey)) {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return formatRupiahPlain(num);
    }
  }

  // Trim ISO datetime strings (e.g. 2026-11-15T09:30:00Z or 2026-11-15 09:30:00) cleanly to YYYY-MM-DD for compact tables
  const keyLower = colKey.trim().toLowerCase();
  if (
    (keyLower.includes('tanggal') || keyLower.includes('tempo') || keyLower.includes('berlaku')) &&
    /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(str)
  ) {
    return str.slice(0, 10);
  }

  return str;
}

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatIndonesianDate(isoOrDate: string | Date): string {
  let year: number;
  let month: number;
  let day: number;

  if (isoOrDate instanceof Date) {
    if (Number.isNaN(isoOrDate.getTime())) return '-';
    year = isoOrDate.getFullYear();
    month = isoOrDate.getMonth();
    day = isoOrDate.getDate();
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoOrDate || '').trim());
    if (!m) return String(isoOrDate || '-');
    year = Number(m[1]);
    month = Number(m[2]) - 1;
    day = Number(m[3]);
  }

  if (month < 0 || month > 11 || day < 1 || day > 31) {
    return typeof isoOrDate === 'string' ? isoOrDate : '-';
  }
  return `${day} ${INDONESIAN_MONTHS[month]} ${year}`;
}

export function extractCityFromAddress(address?: string | null): string {
  const clean = String(address || '').trim();
  if (!clean) return 'Jakarta';
  const segments = clean
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return 'Jakarta';
  const last = segments[segments.length - 1]
    .replace(/\b\d{5}\b/g, '')
    .replace(/^(kota|kab\.?|kabupaten)\s+/i, '')
    .trim();
  return last || 'Jakarta';
}

export interface PdfReportMetadataItem {
  label: string;
  value: string;
}

export interface PdfReportSummaryMetric {
  label: string;
  value: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

export interface PdfReportDocumentModel {
  orientation: 'portrait' | 'landscape';
  institutionName: string;
  institutionTagline: string;
  institutionAddress: string;
  institutionContactLine: string;
  academicPeriodLine: string;
  institutionInitials: string;
  reportTitle: string;
  reportSubtitle: string;
  metadataItems: PdfReportMetadataItem[];
  summaryMetrics: PdfReportSummaryMetric[];
  headers: string[];
  rawColumnKeys: string[];
  columnAlignments: Array<'left' | 'center' | 'right'>;
  bodyRows: string[][];
  signatureDateLine: string;
  principalName: string;
  librarianHeadName: string;
  footerScopeLabel: string;
}

export function buildPdfReportDocumentModel(params: {
  title: string;
  subtitle?: string;
  rows: ReadonlyArray<Record<string, unknown>>;
  letterhead?: {
    name?: string;
    tagline?: string;
    address?: string;
    npsn?: string;
    phone?: string;
    email?: string;
    website?: string;
    academicYear?: string;
    semester?: string;
    principalName?: string;
    librarianHeadName?: string;
  };
  fromDate?: string;
  toDate?: string;
  categoryName?: string;
  className?: string;
  summaryMetrics?: ReadonlyArray<PdfReportSummaryMetric>;
  generatedAt?: Date;
}): PdfReportDocumentModel {
  const lh = params.letterhead || {};
  const rawColumnKeys = params.rows.length > 0 ? Object.keys(params.rows[0]) : [];
  const orientation: 'portrait' | 'landscape' = rawColumnKeys.length >= 6 ? 'landscape' : 'portrait';

  const institutionName = (lh.name || 'Perpustakaan Sekolah').trim();
  const initials = institutionName
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(sd|sdn|perpustakaan|sekolah|dasar)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'LP';

  const contactParts = [
    lh.npsn ? `NPSN: ${lh.npsn}` : '',
    lh.phone ? `Telp: ${lh.phone}` : '',
    lh.email ? `Email: ${lh.email}` : '',
    lh.website ? lh.website : '',
  ].filter(Boolean);

  const academicPeriodLine =
    lh.academicYear || lh.semester
      ? `Tahun Ajaran ${lh.academicYear || '-'} · Semester ${lh.semester || '-'}`
      : '';

  const generatedDate = params.generatedAt || new Date();
  const cleanCategory = normalizeCategoryName(params.categoryName);
  const cleanClass = normalizeClassFilter(params.className);

  const periodValue =
    params.fromDate && params.toDate
      ? `${formatIndonesianDate(params.fromDate)} s/d ${formatIndonesianDate(params.toDate)}`
      : formatIndonesianDate(generatedDate);

  const metadataItems: PdfReportMetadataItem[] = [
    { label: 'Periode Laporan', value: periodValue },
    { label: 'Kategori Buku', value: cleanCategory || 'Semua Kategori Buku' },
    { label: 'Rombel / Kelas', value: cleanClass || 'Semua Rombel / Kelas' },
    { label: 'Jumlah Data', value: `${params.rows.length} baris` },
    {
      label: 'Tahun Ajaran',
      value: lh.academicYear
        ? `${lh.academicYear} (${lh.semester || '-'})`
        : lh.semester || '-',
    },
    { label: 'Tanggal Cetak', value: formatIndonesianDate(generatedDate) },
  ];

  const headers = ['No', ...rawColumnKeys.map(formatReportColumnLabel)];
  const columnAlignments: Array<'left' | 'center' | 'right'> = [
    'center',
    ...rawColumnKeys.map(getReportColumnAlignment),
  ];

  const bodyRows = params.rows.map((row, idx) => [
    String(idx + 1),
    ...rawColumnKeys.map((key) => formatPdfCellValue(key, row[key])),
  ]);

  const city = extractCityFromAddress(lh.address);
  const signatureDateLine = `${city}, ${formatIndonesianDate(generatedDate)}`;

  const footerScopeParts = [institutionName];
  if (cleanCategory) footerScopeParts.push(`Kategori: ${cleanCategory}`);
  if (cleanClass) footerScopeParts.push(cleanClass);

  return {
    orientation,
    institutionName,
    institutionTagline: (lh.tagline || '').trim(),
    institutionAddress: (lh.address || '').trim(),
    institutionContactLine: contactParts.join('  |  '),
    academicPeriodLine,
    institutionInitials: initials,
    reportTitle: params.title.trim(),
    reportSubtitle: (params.subtitle || '').trim(),
    metadataItems,
    summaryMetrics: [...(params.summaryMetrics || [])],
    headers,
    rawColumnKeys,
    columnAlignments,
    bodyRows,
    signatureDateLine,
    principalName: (lh.principalName || '').trim(),
    librarianHeadName: (lh.librarianHeadName || '').trim(),
    footerScopeLabel: footerScopeParts.join(' · '),
  };
}

