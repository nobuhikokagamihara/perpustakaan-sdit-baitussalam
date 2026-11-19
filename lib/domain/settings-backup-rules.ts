export type BackupModuleId =
  | 'catalog'
  | 'members'
  | 'circulation'
  | 'schedules'
  | 'inventory'
  | 'system'
  | 'audit';

export interface BackupModuleDefinition {
  id: BackupModuleId;
  label: string;
  description: string;
  sqliteTables: string[];
  firestoreCollections: string[];
  defaultSelected: boolean;
}

export const BACKUP_MODULES: BackupModuleDefinition[] = [
  {
    id: 'catalog',
    label: 'Katalog & Eksemplar',
    description: 'Judul buku, penulis, penerbit, kategori, lokasi, rak, dan eksemplar fisik.',
    sqliteTables: [
      'authors',
      'publishers',
      'categories',
      'locations',
      'shelves',
      'books',
      'book_authors',
      'book_categories',
      'book_copies',
    ],
    firestoreCollections: ['books', 'public_catalog', 'book_copies', 'categories', 'locations', 'shelves'],
    defaultSelected: true,
  },
  {
    id: 'members',
    label: 'Keanggotaan',
    description: 'Jenis keanggotaan, kebijakan pinjaman, dan data anggota siswa/guru.',
    sqliteTables: ['membership_types', 'members'],
    firestoreCollections: ['membership_types', 'members'],
    defaultSelected: true,
  },
  {
    id: 'circulation',
    label: 'Sirkulasi & Denda',
    description: 'Transaksi pinjaman, item pinjaman, perpanjangan, pengembalian, reservasi, denda, dan pembayaran.',
    sqliteTables: [
      'loans',
      'loan_items',
      'loan_renewals',
      'returns',
      'reservations',
      'fines',
      'payments',
    ],
    firestoreCollections: ['loans', 'returns', 'reservations', 'fines', 'payments'],
    defaultSelected: true,
  },
  {
    id: 'schedules',
    label: 'Jadwal Baca & Kelas SD',
    description: 'Daftar kelas 1A–6B, siswa per kelas, jadwal literasi, log sesi, dan absensi baca.',
    sqliteTables: [
      'school_classes',
      'class_students',
      'reading_schedules',
      'reading_schedule_logs',
      'reading_session_attendance',
    ],
    firestoreCollections: ['school_classes', 'reading_schedules'],
    defaultSelected: true,
  },
  {
    id: 'inventory',
    label: 'Pengadaan & Stock Opname',
    description: 'Pemasok, usulan/penerimaan pengadaan buku, serta sesi audit fisik inventaris.',
    sqliteTables: [
      'suppliers',
      'acquisitions',
      'acquisition_items',
      'inventory_audits',
      'inventory_audit_items',
    ],
    firestoreCollections: ['suppliers', 'acquisitions', 'inventory_audits'],
    defaultSelected: true,
  },
  {
    id: 'system',
    label: 'Pengaturan & RBAC',
    description: 'Peran, izin akses, akun petugas, notifikasi, dan konfigurasi global perpustakaan.',
    sqliteTables: [
      'roles',
      'permissions',
      'role_permissions',
      'users',
      'notifications',
      'library_settings',
    ],
    firestoreCollections: ['library_settings', 'notifications', 'staff_roles'],
    defaultSelected: true,
  },
  {
    id: 'audit',
    label: 'Jejak Audit Sistem',
    description: 'Riwayat aktivitas mutasi data operasional (opsional untuk menjaga ukuran berkas).',
    sqliteTables: ['audit_logs'],
    firestoreCollections: ['audit_logs'],
    defaultSelected: false,
  },
];

// Ordered respecting foreign-key parent -> child dependencies for safe full/selective restores
export const ALL_BACKUP_TABLES: string[] = [
  'roles',
  'permissions',
  'role_permissions',
  'membership_types',
  'members',
  'users',
  'authors',
  'publishers',
  'categories',
  'locations',
  'shelves',
  'books',
  'book_authors',
  'book_categories',
  'book_copies',
  'loans',
  'loan_items',
  'loan_renewals',
  'returns',
  'reservations',
  'fines',
  'payments',
  'suppliers',
  'acquisitions',
  'acquisition_items',
  'inventory_audits',
  'inventory_audit_items',
  'notifications',
  'library_settings',
  'school_classes',
  'class_students',
  'reading_schedules',
  'reading_schedule_logs',
  'reading_session_attendance',
  'audit_logs',
];

export const CORE_BACKUP_MODULES: BackupModuleId[] = [
  'catalog',
  'members',
  'circulation',
  'schedules',
  'inventory',
  'system',
];

export type SchoolRoleCategory =
  | 'Pimpinan & Pengelola'
  | 'Staf & Tenaga Kependidikan'
  | 'Pendidik & Pembina'
  | 'Peserta Didik & Orang Tua';

export interface SchoolRoleDefinition {
  slug: string;
  name: string;
  category: SchoolRoleCategory;
  description: string;
  requiresApproval: boolean;
  allowSelfSignup: boolean;
  defaultMembershipTypeCode: 'SISWA_RENDAH' | 'SISWA_TINGGI' | 'GURU' | 'STAF' | 'KOMITE' | null;
  permissions: string[];
}

export const ALL_STANDARD_PERMISSIONS: string[] = [
  'dashboard.view',
  'books.read',
  'books.write',
  'books.archive',
  'books.import_export',
  'members.read',
  'members.write',
  'members.block',
  'loans.read',
  'loans.write',
  'returns.write',
  'reservations.read',
  'reservations.write',
  'fines.read',
  'fines.pay',
  'fines.waive',
  'inventory.read',
  'inventory.write',
  'acquisitions.read',
  'acquisitions.write',
  'acquisitions.approve',
  'reports.read',
  'notifications.read',
  'settings.read',
  'settings.write',
  'audit.read',
  'schedules.read',
  'schedules.write',
];

const MEMBER_BASE_PERMISSIONS = [
  'books.read',
  'loans.read',
  'reservations.read',
  'reservations.write',
  'fines.read',
  'notifications.read',
  'schedules.read',
];

export const SCHOOL_ROLE_CATALOG: SchoolRoleDefinition[] = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    category: 'Pimpinan & Pengelola',
    description:
      'Akses penuh seluruh sistem perpustakaan sekolah, manajemen akun, persetujuan peran, konfigurasi, dan backup.',
    requiresApproval: true,
    allowSelfSignup: false,
    defaultMembershipTypeCode: null,
    permissions: ['*'],
  },
  {
    slug: 'kepala_sekolah',
    name: 'Kepala Sekolah',
    category: 'Pimpinan & Pengelola',
    description:
      'Pimpinan sekolah: memantau dashboard eksekutif, laporan literasi, persetujuan pengadaan, pengecualian denda, jadwal baca, dan audit sistem.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [
      'dashboard.view',
      'books.read',
      'members.read',
      'loans.read',
      'reservations.read',
      'fines.read',
      'fines.waive',
      'inventory.read',
      'acquisitions.read',
      'acquisitions.approve',
      'reports.read',
      'notifications.read',
      'settings.read',
      'audit.read',
      'schedules.read',
    ],
  },
  {
    slug: 'wakil_kepala_sekolah',
    name: 'Wakil Kepala Sekolah',
    category: 'Pimpinan & Pengelola',
    description:
      'Wakil Kepala Sekolah bidang Kurikulum/Kesiswaan: memantau laporan literasi, jadwal baca kelas, persetujuan pengadaan, dan data anggota.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [
      'dashboard.view',
      'books.read',
      'members.read',
      'loans.read',
      'reservations.read',
      'fines.read',
      'inventory.read',
      'acquisitions.read',
      'acquisitions.approve',
      'reports.read',
      'notifications.read',
      'audit.read',
      'schedules.read',
      'schedules.write',
    ],
  },
  {
    slug: 'kepala_perpustakaan',
    name: 'Kepala Perpustakaan',
    category: 'Pimpinan & Pengelola',
    description:
      'Mengelola koleksi SD, anggota sekolah, menyetujui pengadaan buku, pengecualian denda, melihat laporan literasi, dan memantau aktivitas.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: ALL_STANDARD_PERMISSIONS.filter((c) => c !== 'settings.write'),
  },
  {
    slug: 'admin_perpus',
    name: 'Admin Perpustakaan',
    category: 'Pimpinan & Pengelola',
    description:
      'Administrator harian perpustakaan: mengelola katalog buku, anggota, sirkulasi, stock opname, pengadaan, jadwal baca, dan laporan.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: ALL_STANDARD_PERMISSIONS.filter((c) => c !== 'settings.write'),
  },
  {
    slug: 'pustakawan',
    name: 'Pustakawan / Petugas',
    category: 'Staf & Tenaga Kependidikan',
    description:
      'Mengelola buku, data siswa/guru, peminjaman, pengembalian, reservasi, denda, jadwal baca, dan inventaris rak.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: [
      'dashboard.view',
      'books.read',
      'books.write',
      'books.import_export',
      'members.read',
      'members.write',
      'members.block',
      'loans.read',
      'loans.write',
      'returns.write',
      'reservations.read',
      'reservations.write',
      'fines.read',
      'fines.pay',
      'inventory.read',
      'inventory.write',
      'acquisitions.read',
      'acquisitions.write',
      'reports.read',
      'notifications.read',
      'schedules.read',
      'schedules.write',
    ],
  },
  {
    slug: 'staff_tu',
    name: 'Staf Tata Usaha (TU)',
    category: 'Staf & Tenaga Kependidikan',
    description:
      'Administrasi data anggota siswa/guru, import data rombel, pemantauan tagihan denda, jadwal baca, dan laporan.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: [
      'dashboard.view',
      'books.read',
      'members.read',
      'members.write',
      'loans.read',
      'reservations.read',
      'fines.read',
      'fines.pay',
      'reports.read',
      'notifications.read',
      'schedules.read',
    ],
  },
  {
    slug: 'bendahara_sekolah',
    name: 'Bendahara Sekolah',
    category: 'Staf & Tenaga Kependidikan',
    description:
      'Memantau penerimaan pembayaran denda, verifikasi anggaran pengadaan buku, dan laporan keuangan perpustakaan.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: [
      'dashboard.view',
      'books.read',
      'members.read',
      'fines.read',
      'fines.pay',
      'fines.waive',
      'acquisitions.read',
      'acquisitions.approve',
      'reports.read',
      'notifications.read',
      'audit.read',
    ],
  },
  {
    slug: 'operator_it',
    name: 'Operator IT / Dapodik',
    category: 'Staf & Tenaga Kependidikan',
    description:
      'Sinkronisasi data siswa dan rombongan belajar, dukungan inventaris, audit aktivitas, dan pemantauan pengaturan sistem.',
    requiresApproval: true,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: [
      'dashboard.view',
      'books.read',
      'books.import_export',
      'members.read',
      'members.write',
      'inventory.read',
      'reports.read',
      'notifications.read',
      'settings.read',
      'audit.read',
      'schedules.read',
    ],
  },
  {
    slug: 'petugas_kebersihan_keamanan',
    name: 'Tenaga Kebersihan & Keamanan',
    category: 'Staf & Tenaga Kependidikan',
    description:
      'Staf kebersihan, penjaga sekolah, dan keamanan: akses katalog OPAC, riwayat pinjaman pribadi, reservasi, dan jadwal ruang.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'STAF',
    permissions: [...MEMBER_BASE_PERMISSIONS],
  },
  {
    slug: 'wali_kelas',
    name: 'Wali Kelas',
    category: 'Pendidik & Pembina',
    description:
      'Guru wali kelas SD: mengakses OPAC, pinjaman pribadi, reservasi, serta mengelola jadwal baca dan absensi literasi kelas.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [...MEMBER_BASE_PERMISSIONS, 'schedules.write'],
  },
  {
    slug: 'guru_mapel',
    name: 'Guru Mata Pelajaran',
    category: 'Pendidik & Pembina',
    description:
      'Guru bidang studi (PAI, PJOK, Bahasa Inggris, Seni, dll.): mengakses OPAC, pinjaman referensi ajar, reservasi, dan jadwal baca.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [...MEMBER_BASE_PERMISSIONS, 'acquisitions.read'],
  },
  {
    slug: 'guru_pendamping',
    name: 'Guru Pendamping / Pembina Literasi',
    category: 'Pendidik & Pembina',
    description:
      'Guru pendamping pojok baca dan pembina ekstrakurikuler literasi: mencatat absensi sesi baca kelas, OPAC, dan reservasi.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [...MEMBER_BASE_PERMISSIONS, 'schedules.write'],
  },
  {
    slug: 'guru_bk',
    name: 'Guru BK / Pembina Karakter',
    category: 'Pendidik & Pembina',
    description:
      'Pembina karakter dan konseling siswa: mengakses katalog OPAC, jadwal literasi, serta memantau keterlambatan dan status keanggotaan siswa.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'GURU',
    permissions: [...MEMBER_BASE_PERMISSIONS, 'members.read'],
  },
  {
    slug: 'siswa',
    name: 'Siswa',
    category: 'Peserta Didik & Orang Tua',
    description:
      'Peserta didik SD: mencari koleksi buku di OPAC, melihat pinjaman pribadi, status denda, reservasi, dan jadwal baca kelas.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'SISWA_TINGGI',
    permissions: [...MEMBER_BASE_PERMISSIONS],
  },
  {
    slug: 'duta_literasi',
    name: 'Duta Literasi / Pustakawan Cilik',
    category: 'Peserta Didik & Orang Tua',
    description:
      'Siswa penggerak pojok baca kelas: akses OPAC, reservasi, jadwal literasi, serta membantu memantau ketersediaan buku dan rak.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'SISWA_TINGGI',
    permissions: [...MEMBER_BASE_PERMISSIONS, 'inventory.read'],
  },
  {
    slug: 'komite_sekolah',
    name: 'Komite Sekolah / Orang Tua',
    category: 'Peserta Didik & Orang Tua',
    description:
      'Orang tua/wali murid dan komite sekolah: mengakses katalog OPAC, pinjaman pribadi, reservasi bacaan anak, dan jadwal literasi.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'KOMITE',
    permissions: [...MEMBER_BASE_PERMISSIONS],
  },
  {
    slug: 'anggota',
    name: 'Siswa / Guru (Anggota Umum)',
    category: 'Peserta Didik & Orang Tua',
    description:
      'Mengakses katalog OPAC sekolah, riwayat pinjaman pribadi, status denda, reservasi, dan perpanjangan.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: 'SISWA_TINGGI',
    permissions: [...MEMBER_BASE_PERMISSIONS],
  },
  {
    slug: 'pengunjung',
    name: 'Pengunjung / Tamu',
    category: 'Peserta Didik & Orang Tua',
    description:
      'Melihat katalog publik OPAC perpustakaan SD dan informasi ketersediaan buku.',
    requiresApproval: false,
    allowSelfSignup: true,
    defaultMembershipTypeCode: null,
    permissions: ['books.read'],
  },
];

export const SCHOOL_ROLE_MAP = new Map<string, SchoolRoleDefinition>(
  SCHOOL_ROLE_CATALOG.map((r) => [r.slug, r])
);

export const APPROVAL_REQUIRED_ROLE_SLUGS = new Set(
  SCHOOL_ROLE_CATALOG.filter((r) => r.requiresApproval).map((r) => r.slug)
);

export const MEMBER_ONLY_DEFAULT_ROUTE_SLUGS = new Set([
  'anggota',
  'siswa',
  'duta_literasi',
  'komite_sekolah',
  'pengunjung',
  'petugas_kebersihan_keamanan',
]);

export const SYSTEM_ROLE_SLUGS = new Set([
  ...SCHOOL_ROLE_CATALOG.map((r) => r.slug),
  'petugas_sirkulasi',
]);

export const DEFAULT_SYSTEM_SETTINGS: Record<string, string> = {
  library_name: 'Perpustakaan SD Lentera Pustaka',
  library_tagline: 'Menumbuhkan Budaya Baca Sejak Sekolah Dasar',
  library_address: 'Jl. Pendidikan Nusantara No. 12, Jakarta',
  library_email: 'perpustakaan@lenterapustaka.sch.id',
  library_phone: '(021) 555-0192',
  library_website: 'https://lenterapustaka.sch.id',
  school_npsn: '20109842',
  principal_name: 'Dra. Hj. Ratna Kusuma, M.Pd.',
  librarian_head_name: 'Siti Rahmawati, S.IP.',
  academic_year: '2026/2027',
  semester: 'Ganjil',
  operational_hours: 'Senin–Jumat 07.00–14.30 WIB, Sabtu 07.30–11.30 WIB',
  grace_period_days: '0',
  default_damage_fee_percent: '50',
  lost_book_fee_percent: '100',
  block_on_unpaid_fines_limit: '25000',
  reservation_expiry_days: '3',
  auto_reminder_days_before_due: '2',
  allow_partial_fine_payment: 'true',
  allow_overdue_renewal: 'false',
  enable_opac_public: 'true',
  policy_application_mode: 'new_loans_only',
  backup_auto_frequency: 'weekly',
  backup_retention_count: '10',
  backup_include_audit_logs: 'false',
};

export interface PermissionModuleMeta {
  code: string;
  label: string;
  description: string;
}

export const PERMISSION_MODULE_META: Record<string, PermissionModuleMeta> = {
  dashboard: {
    code: 'dashboard',
    label: 'Dasbor & Ringkasan',
    description: 'Akses statistik harian dan indikator operasional.',
  },
  books: {
    code: 'books',
    label: 'Katalog & Eksemplar',
    description: 'Pengelolaan judul buku, metadata, dan eksemplar fisik.',
  },
  members: {
    code: 'members',
    label: 'Keanggotaan',
    description: 'Pendaftaran, pembaruan, kartu anggota, dan pemblokiran.',
  },
  circulation: {
    code: 'circulation',
    label: 'Sirkulasi (Pinjam & Kembali)',
    description: 'Transaksi peminjaman, perpanjangan, dan pengembalian buku fisik.',
  },
  loans: {
    code: 'loans',
    label: 'Peminjaman & Perpanjangan',
    description: 'Transaksi peminjaman buku, QR checkout, dan perpanjangan.',
  },
  returns: {
    code: 'returns',
    label: 'Pengembalian',
    description: 'Pencatatan pengembalian buku, kondisi fisik, dan denda otomatis.',
  },
  reservations: {
    code: 'reservations',
    label: 'Reservasi & Antrean',
    description: 'Pengelolaan antrean pemesanan buku.',
  },
  fines: {
    code: 'fines',
    label: 'Denda & Pembayaran',
    description: 'Penerimaan pembayaran denda dan pembebasan (waive) denda.',
  },
  acquisitions: {
    code: 'acquisitions',
    label: 'Pengadaan & Pemasok',
    description: 'Usulan pengadaan, persetujuan kepala perpustakaan, dan penerimaan.',
  },
  inventory: {
    code: 'inventory',
    label: 'Stock Opname & Rak',
    description: 'Sesi audit fisik koleksi, lokasi ruang, dan pengelolaan rak.',
  },
  schedules: {
    code: 'schedules',
    label: 'Jadwal Baca Kelas SD',
    description: 'Penjadwalan literasi kelas 1A–6B, daftar siswa, dan absensi baca.',
  },
  reports: {
    code: 'reports',
    label: 'Laporan & Ekspor',
    description: 'Akses analitik bulanan dan ekspor CSV/Excel/PDF.',
  },
  notifications: {
    code: 'notifications',
    label: 'Notifikasi',
    description: 'Peringatan keterlambatan, reservasi siap ambil, dan pengingat.',
  },
  settings: {
    code: 'settings',
    label: 'Pengaturan, RBAC & Backup',
    description: 'Konfigurasi sistem, peran akses, akun staf, audit log, dan backup/restore.',
  },
  audit: {
    code: 'audit',
    label: 'Jejak Audit Sistem',
    description: 'Akses riwayat audit mutasi data operasional dan keamanan sistem.',
  },
};

export interface BackupEnvelopeV2 {
  app: 'Lentera Pustaka';
  version: 2;
  backupId: string;
  label: string;
  mode: 'full' | 'partial';
  sourceEngine: 'sqlite' | 'firestore';
  exportedAt: string;
  exportedBy: string;
  selectedModules: BackupModuleId[];
  checksumAlgorithm: 'SHA-256';
  checksum: string;
  tableCounts: Record<string, number>;
  totalRecords: number;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface BackupValidationResult {
  ok: boolean;
  reason?: string;
  version?: number;
  mode?: 'full' | 'partial';
  sourceEngine?: string;
  exportedAt?: string;
  exportedBy?: string;
  label?: string;
  selectedModules?: BackupModuleId[];
  checksumStatus?: 'verified' | 'mismatch' | 'legacy_no_checksum';
  expectedChecksum?: string;
  computedChecksum?: string;
  tableCounts?: Record<string, number>;
  totalRecords?: number;
}

export interface ModuleDiffRow {
  moduleId: BackupModuleId;
  label: string;
  presentInBackup: boolean;
  currentRows: number;
  backupRows: number;
  delta: number;
  tables: Array<{
    table: string;
    currentRows: number;
    backupRows: number;
    delta: number;
  }>;
}

export interface BackupHealthSummary {
  status: 'Sehat' | 'Perlu Backup' | 'Belum Pernah';
  daysSinceLast: number | null;
  thresholdDays: number;
  recommendation: string;
}

// --- Pure Isomorphic SHA-256 (FIPS 180-4) ---
// Works identically in both Node.js server routes and Browser client code.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeTablesChecksum(tables: Record<string, unknown>): string {
  return sha256Hex(canonicalStringify(tables));
}

export function normalizeSelectedModules(
  requested?: string[] | null,
  includeAudit = false
): BackupModuleId[] {
  const validSet = new Set<BackupModuleId>(BACKUP_MODULES.map((m) => m.id));
  const selected = new Set<BackupModuleId>();

  if (!requested || requested.length === 0) {
    for (const m of CORE_BACKUP_MODULES) selected.add(m);
  } else {
    for (const raw of requested) {
      const id = String(raw).trim() as BackupModuleId;
      if (validSet.has(id)) selected.add(id);
    }
    if (selected.size === 0) {
      for (const m of CORE_BACKUP_MODULES) selected.add(m);
    }
  }

  if (includeAudit) {
    selected.add('audit');
  }

  return BACKUP_MODULES.map((m) => m.id).filter((id) => selected.has(id));
}

export function resolveTablesForModules(moduleIds: BackupModuleId[]): string[] {
  const tableSet = new Set<string>();
  for (const mod of BACKUP_MODULES) {
    if (moduleIds.includes(mod.id)) {
      for (const tbl of mod.sqliteTables) tableSet.add(tbl);
    }
  }
  // Preserve foreign-key parent -> child order defined in ALL_BACKUP_TABLES
  return ALL_BACKUP_TABLES.filter((t) => tableSet.has(t));
}

export function detectModulesInTables(tables: Record<string, unknown>): BackupModuleId[] {
  const found: BackupModuleId[] = [];
  for (const mod of BACKUP_MODULES) {
    const hasAnyTable = mod.sqliteTables.some((tbl) => Array.isArray(tables[tbl]));
    if (hasAnyTable) {
      found.push(mod.id);
    }
  }
  return found;
}

export function buildBackupEnvelope(params: {
  backupId: string;
  label: string;
  sourceEngine: 'sqlite' | 'firestore';
  exportedBy: string;
  selectedModules: BackupModuleId[];
  tables: Record<string, Array<Record<string, unknown>>>;
  exportedAt?: string;
}): BackupEnvelopeV2 {
  const tableCounts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [tbl, rows] of Object.entries(params.tables)) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[tbl] = count;
    totalRecords += count;
  }

  const isFull = CORE_BACKUP_MODULES.every((m) => params.selectedModules.includes(m));
  const checksum = computeTablesChecksum(params.tables);

  return {
    app: 'Lentera Pustaka',
    version: 2,
    backupId: params.backupId,
    label: params.label.trim() || 'Backup Manual',
    mode: isFull ? 'full' : 'partial',
    sourceEngine: params.sourceEngine,
    exportedAt: params.exportedAt || new Date().toISOString(),
    exportedBy: params.exportedBy || 'Super Admin',
    selectedModules: params.selectedModules,
    checksumAlgorithm: 'SHA-256',
    checksum,
    tableCounts,
    totalRecords,
    tables: params.tables,
  };
}

export function validateBackupEnvelope(payload: unknown): BackupValidationResult {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'Format berkas cadangan tidak valid (bukan objek JSON).' };
  }
  const obj = payload as Record<string, unknown>;
  if (obj.app !== 'Lentera Pustaka') {
    return { ok: false, reason: 'Berkas cadangan bukan berasal dari Lentera Pustaka.' };
  }
  const version = Number(obj.version);
  if (!Number.isFinite(version) || version < 1 || version > 2) {
    return { ok: false, reason: 'Versi skema cadangan tidak didukung (hanya mendukung v1 & v2).' };
  }

  const tables = obj.tables as Record<string, unknown> | undefined;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    return { ok: false, reason: 'Struktur tabel cadangan tidak ditemukan.' };
  }

  const allowedTables = new Set(ALL_BACKUP_TABLES);
  const tableCounts: Record<string, number> = {};
  let totalRecords = 0;
  let validTableCount = 0;

  for (const [key, val] of Object.entries(tables)) {
    if (!allowedTables.has(key)) continue;
    if (!Array.isArray(val)) {
      return { ok: false, reason: `Format tabel '${key}' rusak (harus berupa array).` };
    }
    tableCounts[key] = val.length;
    totalRecords += val.length;
    validTableCount++;
  }

  if (validTableCount === 0) {
    return { ok: false, reason: 'Berkas cadangan tidak memiliki tabel Lentera Pustaka yang dikenali.' };
  }

  const detectedModules = detectModulesInTables(tables);
  const declaredModules = Array.isArray(obj.selectedModules)
    ? normalizeSelectedModules(obj.selectedModules as string[], detectedModules.includes('audit'))
    : detectedModules;

  // For legacy v1 full backups, verify core tables exist
  if (version === 1) {
    const requiredV1 = ['roles', 'books', 'book_copies', 'members', 'loans'];
    for (const tbl of requiredV1) {
      if (!Array.isArray(tables[tbl])) {
        return {
          ok: false,
          reason: `Tabel wajib '${tbl}' hilang atau rusak pada berkas cadangan v1.`,
        };
      }
    }
  }

  let checksumStatus: 'verified' | 'mismatch' | 'legacy_no_checksum' = 'legacy_no_checksum';
  let expectedChecksum: string | undefined;
  let computedChecksum: string | undefined;

  if (typeof obj.checksum === 'string' && obj.checksum.trim().length > 0) {
    expectedChecksum = obj.checksum.trim().toLowerCase();
    computedChecksum = computeTablesChecksum(tables);
    checksumStatus = expectedChecksum === computedChecksum ? 'verified' : 'mismatch';
    if (checksumStatus === 'mismatch') {
      return {
        ok: false,
        reason:
          'Verifikasi integritas SHA-256 GAGAL: isi berkas cadangan telah berubah atau korup.',
        version,
        checksumStatus,
        expectedChecksum,
        computedChecksum,
      };
    }
  }

  const mode =
    obj.mode === 'partial' || !CORE_BACKUP_MODULES.every((m) => declaredModules.includes(m))
      ? 'partial'
      : 'full';

  return {
    ok: true,
    version,
    mode,
    sourceEngine: typeof obj.sourceEngine === 'string' ? obj.sourceEngine : 'sqlite',
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    exportedBy: typeof obj.exportedBy === 'string' ? obj.exportedBy : 'Tidak diketahui',
    label: typeof obj.label === 'string' ? obj.label : `Backup v${version}`,
    selectedModules: declaredModules,
    checksumStatus,
    expectedChecksum,
    computedChecksum,
    tableCounts,
    totalRecords,
  };
}

export function computeRestoreDiff(
  currentTableCounts: Record<string, number>,
  backupTables: Record<string, unknown>,
  moduleFilter?: BackupModuleId[]
): ModuleDiffRow[] {
  const filterSet = moduleFilter ? new Set(moduleFilter) : null;
  const rows: ModuleDiffRow[] = [];

  for (const mod of BACKUP_MODULES) {
    if (filterSet && !filterSet.has(mod.id)) continue;

    let currentRows = 0;
    let backupRows = 0;
    let presentInBackup = false;
    const tables: ModuleDiffRow['tables'] = [];

    for (const tbl of mod.sqliteTables) {
      const cur = Number(currentTableCounts[tbl] || 0);
      const raw = backupTables[tbl];
      const hasTbl = Array.isArray(raw);
      if (hasTbl) presentInBackup = true;
      const bkp = hasTbl ? raw.length : 0;
      currentRows += cur;
      backupRows += bkp;
      tables.push({
        table: tbl,
        currentRows: cur,
        backupRows: bkp,
        delta: bkp - cur,
      });
    }

    rows.push({
      moduleId: mod.id,
      label: mod.label,
      presentInBackup,
      currentRows,
      backupRows,
      delta: backupRows - currentRows,
      tables,
    });
  }

  return rows;
}

export function evaluateBackupHealth(
  lastBackupIso: string | null | undefined,
  frequency: string = 'weekly',
  nowIso?: string
): BackupHealthSummary {
  const thresholdDays =
    frequency === 'daily' ? 2 : frequency === 'monthly' ? 32 : frequency === 'manual' ? 14 : 8;

  if (!lastBackupIso) {
    return {
      status: 'Belum Pernah',
      daysSinceLast: null,
      thresholdDays,
      recommendation:
        'Belum ada snapshot cadangan tersimpan. Buat snapshot penuh pertama sekarang untuk melindungi data perpustakaan.',
    };
  }

  const lastMs = Date.parse(lastBackupIso);
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) {
    return {
      status: 'Perlu Backup',
      daysSinceLast: null,
      thresholdDays,
      recommendation: 'Waktu backup terakhir tidak valid. Disarankan membuat snapshot baru.',
    };
  }

  const daysSinceLast = Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000));
  if (daysSinceLast >= thresholdDays) {
    return {
      status: 'Perlu Backup',
      daysSinceLast,
      thresholdDays,
      recommendation: `Backup terakhir berjarak ${daysSinceLast} hari (ambang kebijakan ${thresholdDays} hari). Segera buat cadangan terbaru.`,
    };
  }

  return {
    status: 'Sehat',
    daysSinceLast,
    thresholdDays,
    recommendation:
      daysSinceLast === 0
        ? 'Cadangan data mutakhir (diperbarui hari ini) dengan integritas terverifikasi.'
        : `Cadangan terakhir ${daysSinceLast} hari lalu, masih dalam batas kebijakan ${thresholdDays} hari.`,
  };
}

export function guardSuperAdminLockout(
  roleSlug: string,
  selectedPermissionCodes: string[]
): { ok: boolean; reason?: string; enforcedCodes: string[] } {
  if (roleSlug !== 'super_admin') {
    return { ok: true, enforcedCodes: selectedPermissionCodes };
  }
  const hasWildcard = selectedPermissionCodes.includes('*');
  if (hasWildcard) {
    return { ok: true, enforcedCodes: selectedPermissionCodes };
  }
  const required = ['settings.read', 'settings.write'];
  const missing = required.filter((code) => !selectedPermissionCodes.includes(code));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Super Admin tidak boleh kehilangan izin kritis (${missing.join(', ')}) agar tidak terkunci dari sistem.`,
      enforcedCodes: Array.from(new Set([...selectedPermissionCodes, ...required])),
    };
  }
  return { ok: true, enforcedCodes: selectedPermissionCodes };
}

export function validateCustomRoleInput(input: {
  slug?: string;
  name?: string;
  description?: string;
}): { ok: boolean; reason?: string; normalizedSlug?: string } {
  const name = String(input.name || '').trim();
  if (name.length < 3 || name.length > 60) {
    return { ok: false, reason: 'Nama peran harus terdiri dari 3 hingga 60 karakter.' };
  }
  const rawSlug = String(input.slug || name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (rawSlug.length < 3 || rawSlug.length > 40 || !/^[a-z][a-z0-9_]*$/.test(rawSlug)) {
    return {
      ok: false,
      reason: 'Slug peran harus diawali huruf kecil dan hanya berisi huruf kecil, angka, atau garis bawah.',
    };
  }
  if (SYSTEM_ROLE_SLUGS.has(rawSlug)) {
    return {
      ok: false,
      reason: `Slug '${rawSlug}' sudah digunakan oleh peran bawaan sistem.`,
    };
  }
  return { ok: true, normalizedSlug: rawSlug };
}

export function validateMembershipPolicyInput(input: {
  code?: string;
  name?: string;
  max_loans: number;
  loan_duration_days: number;
  max_renewals: number;
  daily_fine_rate: number;
  max_fine_cap: number;
}): { ok: boolean; reason?: string } {
  if (input.code !== undefined) {
    const code = String(input.code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) {
      return {
        ok: false,
        reason: 'Kode jenis anggota harus 2–24 karakter huruf kapital, angka, atau tanda hubung.',
      };
    }
  }
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, reason: 'Nama jenis anggota harus antara 2–80 karakter.' };
  }
  if (!Number.isFinite(input.max_loans) || input.max_loans < 1 || input.max_loans > 30) {
    return { ok: false, reason: 'Maksimal pinjaman harus antara 1 hingga 30 buku.' };
  }
  if (
    !Number.isFinite(input.loan_duration_days) ||
    input.loan_duration_days < 1 ||
    input.loan_duration_days > 90
  ) {
    return { ok: false, reason: 'Durasi pinjaman harus antara 1 hingga 90 hari.' };
  }
  if (!Number.isFinite(input.max_renewals) || input.max_renewals < 0 || input.max_renewals > 10) {
    return { ok: false, reason: 'Batas perpanjangan harus antara 0 hingga 10 kali.' };
  }
  if (!Number.isFinite(input.daily_fine_rate) || input.daily_fine_rate < 0) {
    return { ok: false, reason: 'Tarif denda harian tidak boleh negatif.' };
  }
  if (!Number.isFinite(input.max_fine_cap) || input.max_fine_cap < 0) {
    return { ok: false, reason: 'Batas maksimal denda tidak boleh negatif.' };
  }
  if (input.max_fine_cap > 0 && input.daily_fine_rate > input.max_fine_cap) {
    return {
      ok: false,
      reason: 'Batas maksimal denda (cap) tidak boleh lebih kecil dari tarif denda harian.',
    };
  }
  return { ok: true };
}

export function validatePasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, reason: 'Kata sandi minimal harus 8 karakter.' };
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: 'Kata sandi harus mengandung kombinasi huruf dan angka.' };
  }
  return { ok: true };
}

export function doesRoleRequireApproval(
  roleSlug: string,
  customRequiresApproval?: boolean | number | null
): boolean {
  if (customRequiresApproval !== undefined && customRequiresApproval !== null) {
    return Boolean(customRequiresApproval);
  }
  return APPROVAL_REQUIRED_ROLE_SLUGS.has(roleSlug);
}

export function isStaffOperationalPermissions(permissions: string[]): boolean {
  if (permissions.includes('*')) return true;
  return (
    permissions.includes('dashboard.view') ||
    permissions.includes('loans.write') ||
    permissions.includes('books.write') ||
    permissions.includes('members.read') ||
    permissions.includes('fines.pay') ||
    permissions.includes('settings.read')
  );
}

export function normalizeUsernameFromInput(rawUsername: string, email: string): string {
  const source = rawUsername.trim() || email.split('@')[0] || '';
  return source
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);
}

export function validateSignupInput(input: {
  fullName: string;
  email: string;
  username?: string;
  password: string;
  roleSlug: string;
}): { ok: boolean; reason?: string; cleanUsername?: string; cleanEmail?: string; cleanFullName?: string } {
  const cleanFullName = String(input.fullName || '').trim();
  if (cleanFullName.length < 2 || cleanFullName.length > 120) {
    return { ok: false, reason: 'Nama lengkap minimal 2 hingga 120 karakter.' };
  }
  const cleanEmail = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 160) {
    return { ok: false, reason: 'Format alamat email tidak valid.' };
  }
  const cleanUsername = normalizeUsernameFromInput(String(input.username || ''), cleanEmail);
  if (cleanUsername.length < 3 || !/^[a-z0-9][a-z0-9._-]*$/.test(cleanUsername)) {
    return {
      ok: false,
      reason: 'Username minimal 3 karakter (huruf kecil, angka, titik, garis bawah, atau tanda hubung).',
    };
  }
  const passCheck = validatePasswordStrength(input.password);
  if (!passCheck.ok) {
    return { ok: false, reason: passCheck.reason };
  }
  const roleSlug = String(input.roleSlug || '').trim();
  if (!roleSlug || roleSlug === 'super_admin') {
    return { ok: false, reason: 'Peran yang dipilih tidak tersedia untuk pendaftaran mandiri.' };
  }
  return {
    ok: true,
    cleanFullName,
    cleanEmail,
    cleanUsername,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface LibraryIdentity {
  name: string;
  tagline: string;
  operatingHours: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  npsn: string;
  principalName: string;
  librarianHeadName: string;
  academicYear: string;
  semester: string;
  enableOpacPublic: boolean;
}

export interface CirculationPolicySettings {
  gracePeriodDays: number;
  damageFeePercent: number;
  lostFeePercent: number;
  blockOnUnpaidFinesLimit: number;
  reservationExpiryDays: number;
  autoReminderDaysBeforeDue: number;
  allowPartialFinePayment: boolean;
  allowOverdueRenewal: boolean;
  enableOpacPublic: boolean;
  policyApplicationMode: 'new_loans_only' | 'apply_to_active';
}

export function parseNumberSetting(
  value: unknown,
  fallback: number,
  min = 0,
  max?: number
): number {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) {
    return fallback;
  }
  if (max !== undefined && num > max) {
    return max;
  }
  return num;
}

export function extractLibraryIdentity(
  settings?: Record<string, string | undefined> | null
): LibraryIdentity {
  const s = settings || {};
  const str = (key: string, fallback = '') => {
    const v = s[key];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
  };
  const hours =
    str('operational_hours') ||
    str('operating_hours') ||
    DEFAULT_SYSTEM_SETTINGS.operational_hours;

  return {
    name: str('library_name', DEFAULT_SYSTEM_SETTINGS.library_name),
    tagline: str('library_tagline', DEFAULT_SYSTEM_SETTINGS.library_tagline),
    operatingHours: hours,
    address: str('library_address', DEFAULT_SYSTEM_SETTINGS.library_address),
    phone: str('library_phone', DEFAULT_SYSTEM_SETTINGS.library_phone),
    email: str('library_email', DEFAULT_SYSTEM_SETTINGS.library_email),
    website: str('library_website', DEFAULT_SYSTEM_SETTINGS.library_website),
    npsn: str('school_npsn', DEFAULT_SYSTEM_SETTINGS.school_npsn),
    principalName: str('principal_name', DEFAULT_SYSTEM_SETTINGS.principal_name),
    librarianHeadName: str('librarian_head_name', DEFAULT_SYSTEM_SETTINGS.librarian_head_name),
    academicYear: str('academic_year', DEFAULT_SYSTEM_SETTINGS.academic_year),
    semester: str('semester', DEFAULT_SYSTEM_SETTINGS.semester),
    enableOpacPublic: s.enable_opac_public !== 'false',
  };
}

export function extractCirculationPolicy(
  settings?: Record<string, string | undefined> | null
): CirculationPolicySettings {
  const s = settings || {};
  let reservationExpiryDays = parseNumberSetting(s.reservation_expiry_days, -1, 1, 30);
  if (reservationExpiryDays < 1) {
    const legacyHours = parseNumberSetting(s.reservation_pickup_hours, 72, 24, 720);
    reservationExpiryDays = Math.max(1, Math.ceil(legacyHours / 24));
  }

  const reminderRaw =
    s.auto_reminder_days_before_due !== undefined && s.auto_reminder_days_before_due !== ''
      ? s.auto_reminder_days_before_due
      : s.notify_due_days_before;

  return {
    gracePeriodDays: parseNumberSetting(s.grace_period_days, 0, 0, 30),
    damageFeePercent: parseNumberSetting(s.default_damage_fee_percent, 50, 0, 100),
    lostFeePercent: parseNumberSetting(s.lost_book_fee_percent, 100, 0, 200),
    blockOnUnpaidFinesLimit: parseNumberSetting(s.block_on_unpaid_fines_limit, 25000, 0),
    reservationExpiryDays,
    autoReminderDaysBeforeDue: parseNumberSetting(reminderRaw, 2, 0, 30),
    allowPartialFinePayment: s.allow_partial_fine_payment !== 'false',
    allowOverdueRenewal: s.allow_overdue_renewal === 'true',
    enableOpacPublic: s.enable_opac_public !== 'false',
    policyApplicationMode:
      s.policy_application_mode === 'apply_to_active' ? 'apply_to_active' : 'new_loans_only',
  };
}

