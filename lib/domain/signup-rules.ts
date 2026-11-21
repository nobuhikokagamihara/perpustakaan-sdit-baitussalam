export type RoleSignupFieldType = 'select' | 'text' | 'checkbox';

export interface RoleSignupFieldDef {
  key: string;
  label: string;
  type: RoleSignupFieldType;
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
  defaultValue?: string;
}

export interface RoleSignupConfig {
  slug: string;
  categoryLabel: string;
  summaryHint: string;
  requiresClassDropdown: boolean;
  classDropdownLabel: string;
  classDropdownOptional?: boolean;
  classSyncSlot: 'homeroom' | 'companion' | 'student' | 'parent' | null;
  identityFieldLabel: string;
  identityFieldPlaceholder: string;
  identityRequired: boolean;
  showGenderField: boolean;
  showPhoneField: boolean;
  phoneRequired?: boolean;
  leadershipSettingKey?: 'principal_name' | 'librarian_head_name';
  leadershipLabel?: string;
  extraFields: RoleSignupFieldDef[];
}

export interface PublicClassOption {
  id: string | number;
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  hasHomeroomTeacher: boolean;
  hasCompanionTeacher: boolean;
  studentCount?: number;
}

export interface TeacherConflictResult {
  hasConflict: boolean;
  conflictType: 'class_homeroom_teacher' | 'class_companion_teacher' | 'library_leadership' | null;
  slot: 'homeroom' | 'companion' | null;
  existingValue: string;
  existingHolderUserId: number | null;
  existingHolderEmail: string | null;
  summary: string;
}

export interface SignupValidationInput {
  roleSlug: string;
  fullName: string;
  assignedClass?: string | null;
  identityNumber?: string | null;
  gender?: string | null;
  phone?: string | null;
  extraMeta?: Record<string, string | boolean | undefined | null>;
}

export interface SignupValidationResult {
  valid: boolean;
  error?: string;
  normalizedClass: string;
  normalizedUnitOrClass: string;
  normalizedIdentity: string;
  normalizedGender: 'L' | 'P' | '';
  normalizedPhone: string;
  normalizedExtraMeta: Record<string, string>;
}

export const REGISTRATION_APPROVER_ROLE_SLUGS = [
  'super_admin',
  'admin_perpus',
  'kepala_perpustakaan',
] as const;

export const SUBJECT_OPTIONS = [
  'Pendidikan Agama & Budi Pekerti',
  'Pendidikan Pancasila (PPKn)',
  'Bahasa Indonesia',
  'Matematika',
  'IPAS (IPA & IPS)',
  'PJOK (Olahraga)',
  'Seni Budaya & Prakarya',
  'Bahasa Inggris',
  'Bahasa Daerah',
  'Informatika / TIK',
  'Ekstrakurikuler & Literasi',
];

export const BK_SCOPE_OPTIONS = [
  'Kelas Rendah (Kelas 1 - 3)',
  'Kelas Tinggi (Kelas 4 - 6)',
  'Seluruh Jenjang (Kelas 1 - 6)',
  'Layanan Inklusi & Konseling Khusus',
];

export const WAKASEK_FIELD_OPTIONS = [
  'Wakasek Kurikulum',
  'Wakasek Kesiswaan',
  'Wakasek Sarana & Prasarana',
  'Wakasek Humas & Kemitraan',
];

export const KOMITE_RELATION_OPTIONS = [
  'Orang Tua / Wali Murid',
  'Ketua Komite Sekolah',
  'Pengurus Komite Sekolah',
  'Paguyuban Kelas',
];

export const SERVICE_SHIFT_OPTIONS = [
  'Shift Pagi (07.00 - 12.00)',
  'Shift Siang (12.00 - 16.00)',
  'Penuh Waktu (07.00 - 15.00)',
];

export const LIBRARY_AREA_OPTIONS = [
  'Sirkulasi & Peminjaman',
  'Pengolahan & Katalogisasi',
  'Layanan Referensi & Literasi',
  'Pengelolaan Koleksi & Perawatan',
];

export const TU_SECTION_OPTIONS = [
  'Administrasi Kesiswaan',
  'Administrasi Kepegawaian',
  'Persuratan & Arsip Sekolah',
  'Inventaris & Perlengkapan',
];

export const TREASURER_FUND_OPTIONS = [
  'Dana BOS Reguler',
  'Dana Komite & Sarana',
  'Anggaran Pengadaan Perpustakaan',
  'Bendahara Umum Sekolah',
];

export const IT_FOCUS_OPTIONS = [
  'Dapodik & Data Pokok Sekolah',
  'Jaringan, Server & Perangkat',
  'Sistem Perpustakaan & OPAC',
  'Dukungan Teknis Harian',
];

export const SECURITY_CLEANING_AREA_OPTIONS = [
  'Keamanan Gerbang & Lingkungan Sekolah',
  'Kebersihan Ruang Perpustakaan & Kelas',
  'Kebersihan Area Umum & Taman',
  'Penjaga Sekolah / Malam',
];

export const GENERAL_MEMBER_STATUS_OPTIONS = [
  'Siswa',
  'Guru / Pendidik',
  'Staf / Tenaga Kependidikan',
  'Warga / Mitra Sekolah',
];

export const LITERACY_DUTY_OPTIONS = [
  'Pojok Baca Kelas',
  'Duta Mading & Resensi Buku',
  'Asisten Sirkulasi Istirahat',
  'Klub Membaca Sekolah',
];

export const ROLE_SIGNUP_CONFIGS: Record<string, RoleSignupConfig> = {
  siswa: {
    slug: 'siswa',
    categoryLabel: 'Peserta Didik',
    summaryHint: 'Pilih kelas yang sudah terdaftar di sekolah agar data keanggotaan dan kategori peminjaman (Kelas Rendah/Tinggi) otomatis sesuai.',
    requiresClassDropdown: true,
    classDropdownLabel: 'Pilih Kelas',
    classSyncSlot: 'student',
    identityFieldLabel: 'NIS / NISN',
    identityFieldPlaceholder: 'Contoh: 202601015',
    identityRequired: false,
    showGenderField: true,
    showPhoneField: false,
    extraFields: [],
  },
  duta_literasi: {
    slug: 'duta_literasi',
    categoryLabel: 'Siswa Penggerak Literasi',
    summaryHint: 'Pilih kelas asal siswa duta literasi beserta fokus kegiatan literasi yang dibantu di sekolah.',
    requiresClassDropdown: true,
    classDropdownLabel: 'Pilih Kelas Asal',
    classSyncSlot: 'student',
    identityFieldLabel: 'NIS / NISN',
    identityFieldPlaceholder: 'Contoh: 202604008',
    identityRequired: false,
    showGenderField: true,
    showPhoneField: false,
    extraFields: [
      {
        key: 'literacyDuty',
        label: 'Fokus Tugas Duta Literasi',
        type: 'select',
        required: true,
        options: LITERACY_DUTY_OPTIONS,
        defaultValue: LITERACY_DUTY_OPTIONS[0],
      },
    ],
  },
  wali_kelas: {
    slug: 'wali_kelas',
    categoryLabel: 'Guru Wali Kelas',
    summaryHint: 'Pilih kelas binaan. Jika slot wali kelas masih kosong, nama Anda langsung tersinkron ke data rombel & jadwal baca. Jika sudah terisi, pendaftaran masuk antrean persetujuan untuk resolusi konflik.',
    requiresClassDropdown: true,
    classDropdownLabel: 'Pilih Kelas Binaan',
    classSyncSlot: 'homeroom',
    identityFieldLabel: 'NIP / NUPTK',
    identityFieldPlaceholder: 'Contoh: 19880512 201503 2 004',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [],
  },
  guru_pendamping: {
    slug: 'guru_pendamping',
    categoryLabel: 'Guru Pendamping Kelas',
    summaryHint: 'Pilih kelas yang didampingi. Jika slot guru pendamping masih kosong, nama Anda langsung tersinkron ke rombel & jadwal baca. Jika sudah ada pendamping lain, menunggu persetujuan admin/kepala perpus.',
    requiresClassDropdown: true,
    classDropdownLabel: 'Pilih Kelas yang Didampingi',
    classSyncSlot: 'companion',
    identityFieldLabel: 'NIP / NUPTK',
    identityFieldPlaceholder: 'Contoh: 19930420 202012 1 007',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [],
  },
  guru_mapel: {
    slug: 'guru_mapel',
    categoryLabel: 'Guru Mata Pelajaran',
    summaryHint: 'Pilih mata pelajaran utama yang diampu agar profil pendidik dan rekomendasi koleksi sesuai.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / NUPTK',
    identityFieldPlaceholder: 'Contoh: 19860214 201402 1 003',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'subjectName',
        label: 'Mata Pelajaran Diampu',
        type: 'select',
        required: true,
        options: SUBJECT_OPTIONS,
        defaultValue: SUBJECT_OPTIONS[2],
      },
    ],
  },
  guru_bk: {
    slug: 'guru_bk',
    categoryLabel: 'Guru BK / Konselor',
    summaryHint: 'Tentukan lingkup jenjang binaan layanan bimbingan konseling di sekolah.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / NUPTK',
    identityFieldPlaceholder: 'Contoh: 19900718 201903 2 005',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'bkScope',
        label: 'Lingkup Binaan Konseling',
        type: 'select',
        required: true,
        options: BK_SCOPE_OPTIONS,
        defaultValue: BK_SCOPE_OPTIONS[2],
      },
    ],
  },
  komite_sekolah: {
    slug: 'komite_sekolah',
    categoryLabel: 'Komite / Orang Tua Murid',
    summaryHint: 'Pilih kelas anak (opsional) dan peran Anda dalam komite/paguyuban sekolah.',
    requiresClassDropdown: true,
    classDropdownLabel: 'Kelas Anak (Opsional)',
    classDropdownOptional: true,
    classSyncSlot: 'parent',
    identityFieldLabel: 'NIK / ID Anggota (Opsional)',
    identityFieldPlaceholder: 'Nomor identitas singkat',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'committeeRelation',
        label: 'Status di Komite / Orang Tua',
        type: 'select',
        required: true,
        options: KOMITE_RELATION_OPTIONS,
        defaultValue: KOMITE_RELATION_OPTIONS[0],
      },
      {
        key: 'childName',
        label: 'Nama Anak / Siswa (Opsional)',
        type: 'text',
        required: false,
        placeholder: 'Contoh: Ahmad Fauzan',
      },
    ],
  },
  anggota: {
    slug: 'anggota',
    categoryLabel: 'Anggota Umum Perpustakaan',
    summaryHint: 'Tentukan status keanggotaan Anda di lingkungan sekolah untuk menyesuaikan kuota pinjaman.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIS / NIP / ID Warga (Opsional)',
    identityFieldPlaceholder: 'Nomor induk atau kartu identitas',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'memberSubStatus',
        label: 'Status Warga Sekolah',
        type: 'select',
        required: true,
        options: GENERAL_MEMBER_STATUS_OPTIONS,
        defaultValue: GENERAL_MEMBER_STATUS_OPTIONS[0],
      },
      {
        key: 'unitLabel',
        label: 'Unit / Bagian / Keterangan',
        type: 'text',
        required: false,
        placeholder: 'Contoh: Alumni / Paguyuban / Ekstrakurikuler',
      },
    ],
  },
  pengunjung: {
    slug: 'pengunjung',
    categoryLabel: 'Pengunjung / Tamu Katalog',
    summaryHint: 'Akses baca katalog OPAC publik. Isi asal instansi atau keperluan kunjungan bila berkenan.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'Nomor Identitas Tamu (Opsional)',
    identityFieldPlaceholder: 'Opsional',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: false,
    extraFields: [
      {
        key: 'visitorOrigin',
        label: 'Asal Instansi / Keperluan (Opsional)',
        type: 'text',
        required: false,
        placeholder: 'Contoh: Pengawas Dinas Pendidikan / Orang Tua Calon Siswa',
      },
    ],
  },
  petugas_kebersihan_keamanan: {
    slug: 'petugas_kebersihan_keamanan',
    categoryLabel: 'Petugas Kebersihan & Keamanan',
    summaryHint: 'Pilih area penugasan harian agar terdaftar di direktori warga sekolah.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'ID Pegawai (Opsional)',
    identityFieldPlaceholder: 'Contoh: PEG-012',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'dutyArea',
        label: 'Area Tugas Utama',
        type: 'select',
        required: true,
        options: SECURITY_CLEANING_AREA_OPTIONS,
        defaultValue: SECURITY_CLEANING_AREA_OPTIONS[0],
      },
    ],
  },
  kepala_sekolah: {
    slug: 'kepala_sekolah',
    categoryLabel: 'Pimpinan Sekolah',
    summaryHint: 'Akun Kepala Sekolah memerlukan verifikasi sebelum aktif. Jika nama Kepala Sekolah di Kop Surat berbeda, peninjau dapat memilih apakah ingin menyinkronkannya.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP Kepala Sekolah',
    identityFieldPlaceholder: 'Contoh: 19720315 199802 1 001',
    identityRequired: true,
    showGenderField: false,
    showPhoneField: true,
    leadershipSettingKey: 'principal_name',
    leadershipLabel: 'Kepala Sekolah (Kop Surat)',
    extraFields: [
      {
        key: 'decreeNumber',
        label: 'Nomor SK Pengangkatan (Opsional)',
        type: 'text',
        required: false,
        placeholder: 'Contoh: SK/821/2025/DISDIK',
      },
    ],
  },
  wakil_kepala_sekolah: {
    slug: 'wakil_kepala_sekolah',
    categoryLabel: 'Pimpinan Sekolah',
    summaryHint: 'Pilih bidang koordinasi Wakil Kepala Sekolah. Akun menunggu persetujuan sebelum aktif.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / NUPTK',
    identityFieldPlaceholder: 'Contoh: 19780822 200501 2 002',
    identityRequired: true,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'wakasekField',
        label: 'Bidang Wakil Kepala Sekolah',
        type: 'select',
        required: true,
        options: WAKASEK_FIELD_OPTIONS,
        defaultValue: WAKASEK_FIELD_OPTIONS[0],
      },
    ],
  },
  kepala_perpustakaan: {
    slug: 'kepala_perpustakaan',
    categoryLabel: 'Pimpinan Perpustakaan',
    summaryHint: 'Akun Kepala Perpustakaan memerlukan persetujuan terlebih dahulu. Peninjau dapat memilih untuk menyinkronkan nama ke Kop Surat & laporan PDF.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / Nomor Sertifikat Perpustakaan',
    identityFieldPlaceholder: 'Contoh: 19810610 200801 2 006',
    identityRequired: true,
    showGenderField: false,
    showPhoneField: true,
    leadershipSettingKey: 'librarian_head_name',
    leadershipLabel: 'Kepala Perpustakaan (Kop Surat)',
    extraFields: [
      {
        key: 'qualification',
        label: 'Kualifikasi / Sertifikasi (Opsional)',
        type: 'text',
        required: false,
        placeholder: 'Contoh: S.I.Pust. / Diklat Kepala Perpustakaan',
      },
    ],
  },
  admin_perpus: {
    slug: 'admin_perpus',
    categoryLabel: 'Pengelola Operasional Perpustakaan',
    summaryHint: 'Tentukan shift layanan Anda. Akun staf pengelola memerlukan persetujuan sebelum aktif.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / ID Pegawai',
    identityFieldPlaceholder: 'Contoh: 19910305 201903 2 011',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'serviceShift',
        label: 'Shift / Jam Layanan',
        type: 'select',
        required: true,
        options: SERVICE_SHIFT_OPTIONS,
        defaultValue: SERVICE_SHIFT_OPTIONS[2],
      },
    ],
  },
  pustakawan: {
    slug: 'pustakawan',
    categoryLabel: 'Staf Pustakawan',
    summaryHint: 'Pilih area layanan perpustakaan yang menjadi fokus kerja harian Anda.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / ID Pustakawan',
    identityFieldPlaceholder: 'Contoh: 19940914 202203 2 008',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'libraryArea',
        label: 'Area Layanan Perpustakaan',
        type: 'select',
        required: true,
        options: LIBRARY_AREA_OPTIONS,
        defaultValue: LIBRARY_AREA_OPTIONS[0],
      },
    ],
  },
  staff_tu: {
    slug: 'staff_tu',
    categoryLabel: 'Staf Tata Usaha',
    summaryHint: 'Pilih sub-bagian urusan Tata Usaha yang Anda tangani di sekolah.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / ID Staf TU',
    identityFieldPlaceholder: 'Contoh: 19891201 201604 1 004',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'tuSection',
        label: 'Urusan Tata Usaha',
        type: 'select',
        required: true,
        options: TU_SECTION_OPTIONS,
        defaultValue: TU_SECTION_OPTIONS[0],
      },
    ],
  },
  bendahara_sekolah: {
    slug: 'bendahara_sekolah',
    categoryLabel: 'Keuangan Sekolah',
    summaryHint: 'Pilih lingkup pengelolaan dana sekolah. Akun memerlukan persetujuan pengelola sebelum aktif.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / ID Bendahara',
    identityFieldPlaceholder: 'Contoh: 19840419 201101 2 009',
    identityRequired: true,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'fundScope',
        label: 'Pengelolaan Anggaran',
        type: 'select',
        required: true,
        options: TREASURER_FUND_OPTIONS,
        defaultValue: TREASURER_FUND_OPTIONS[0],
      },
    ],
  },
  operator_it: {
    slug: 'operator_it',
    categoryLabel: 'Operator & Teknis TI',
    summaryHint: 'Pilih fokus tugas teknis IT / Dapodik sekolah Anda.',
    requiresClassDropdown: false,
    classDropdownLabel: 'Kelas',
    classSyncSlot: null,
    identityFieldLabel: 'NIP / ID Operator',
    identityFieldPlaceholder: 'Contoh: 19950621 202102 1 003',
    identityRequired: false,
    showGenderField: false,
    showPhoneField: true,
    extraFields: [
      {
        key: 'itFocus',
        label: 'Fokus Tugas Operator',
        type: 'select',
        required: true,
        options: IT_FOCUS_OPTIONS,
        defaultValue: IT_FOCUS_OPTIONS[0],
      },
    ],
  },
};

export function getRoleSignupConfig(roleSlug: string): RoleSignupConfig {
  const normalized = String(roleSlug || '').trim().toLowerCase();
  return (
    ROLE_SIGNUP_CONFIGS[normalized] || {
      slug: normalized || 'anggota',
      categoryLabel: 'Warga Sekolah',
      summaryHint: 'Lengkapi data identitas sesuai peran Anda di sekolah.',
      requiresClassDropdown: false,
      classDropdownLabel: 'Kelas',
      classSyncSlot: null,
      identityFieldLabel: 'NIS / NIP / Nomor Identitas (Opsional)',
      identityFieldPlaceholder: 'Opsional',
      identityRequired: false,
      showGenderField: false,
      showPhoneField: true,
      extraFields: [],
    }
  );
}

export function canRoleApproveRegistrations(roleSlug: string | null | undefined): boolean {
  if (!roleSlug) return false;
  return (REGISTRATION_APPROVER_ROLE_SLUGS as readonly string[]).includes(
    String(roleSlug).trim().toLowerCase()
  );
}

export function canApproverAssignRole(
  approverRoleSlug: string | null | undefined,
  targetRoleSlug: string | null | undefined
): boolean {
  const approver = String(approverRoleSlug || '').trim().toLowerCase();
  const target = String(targetRoleSlug || '').trim().toLowerCase();
  if (!canRoleApproveRegistrations(approver)) return false;
  if (target === 'super_admin' && approver !== 'super_admin') return false;
  return true;
}

export function isPlaceholderTeacherName(name: string | null | undefined): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower === '-' ||
    lower === '--' ||
    lower === '—' ||
    lower === 'n/a' ||
    lower === 'kosong' ||
    lower === 'belum diisi' ||
    lower === 'belum ada' ||
    lower === 'belum ditentukan' ||
    lower === 'belum ditetapkan' ||
    lower === 'tidak ada'
  );
}

export function normalizeTeacherDisplay(name: string | null | undefined): string {
  const trimmed = String(name || '').trim();
  return isPlaceholderTeacherName(trimmed) ? '' : trimmed;
}

export function extractGradeLevelFromClassName(className: string): number {
  const match = String(className || '').match(/\d+/);
  const parsed = match ? Number(match[0]) : 1;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  if (parsed > 12) return 6;
  return parsed;
}

export function detectClassTeacherConflict(params: {
  roleSlug: string;
  selectedClass: string;
  applicantFullName: string;
  classRecord: {
    className: string;
    homeroomTeacher?: string | null;
    companionTeacher?: string | null;
  } | null;
  existingActiveHolder?: {
    userId?: number | null;
    fullName?: string | null;
    email?: string | null;
  } | null;
}): TeacherConflictResult {
  const roleSlug = String(params.roleSlug || '').trim().toLowerCase();
  if (roleSlug !== 'wali_kelas' && roleSlug !== 'guru_pendamping') {
    return {
      hasConflict: false,
      conflictType: null,
      slot: null,
      existingValue: '',
      existingHolderUserId: null,
      existingHolderEmail: null,
      summary: '',
    };
  }

  const slot: 'homeroom' | 'companion' = roleSlug === 'wali_kelas' ? 'homeroom' : 'companion';
  const slotLabel = slot === 'homeroom' ? 'Wali Kelas' : 'Guru Pendamping';
  const className = params.classRecord?.className || params.selectedClass;

  const currentClassTeacher = normalizeTeacherDisplay(
    slot === 'homeroom' ? params.classRecord?.homeroomTeacher : params.classRecord?.companionTeacher
  );
  const activeHolderName = normalizeTeacherDisplay(params.existingActiveHolder?.fullName);

  const existingValue = currentClassTeacher || activeHolderName;
  if (!existingValue) {
    return {
      hasConflict: false,
      conflictType: null,
      slot,
      existingValue: '',
      existingHolderUserId: null,
      existingHolderEmail: null,
      summary: '',
    };
  }

  const holderDetail = params.existingActiveHolder?.email
    ? ` (akun: ${params.existingActiveHolder.email})`
    : '';

  return {
    hasConflict: true,
    conflictType: slot === 'homeroom' ? 'class_homeroom_teacher' : 'class_companion_teacher',
    slot,
    existingValue,
    existingHolderUserId: params.existingActiveHolder?.userId ?? null,
    existingHolderEmail: params.existingActiveHolder?.email ?? null,
    summary: `${className} sudah memiliki ${slotLabel} terdaftar: "${existingValue}"${holderDetail}. Menunggu keputusan Super Admin / Admin Perpustakaan / Kepala Perpustakaan untuk memilih data yang diterapkan.`,
  };
}

export function detectLibraryLeadershipConflict(params: {
  roleSlug: string;
  applicantFullName: string;
  principalName?: string | null;
  librarianHeadName?: string | null;
}): TeacherConflictResult {
  const roleSlug = String(params.roleSlug || '').trim().toLowerCase();
  if (roleSlug !== 'kepala_sekolah' && roleSlug !== 'kepala_perpustakaan') {
    return {
      hasConflict: false,
      conflictType: null,
      slot: null,
      existingValue: '',
      existingHolderUserId: null,
      existingHolderEmail: null,
      summary: '',
    };
  }

  const existingValue = normalizeTeacherDisplay(
    roleSlug === 'kepala_sekolah' ? params.principalName : params.librarianHeadName
  );
  const label = roleSlug === 'kepala_sekolah' ? 'Kepala Sekolah' : 'Kepala Perpustakaan';

  if (
    !existingValue ||
    existingValue.toLowerCase() === String(params.applicantFullName || '').trim().toLowerCase()
  ) {
    return {
      hasConflict: false,
      conflictType: null,
      slot: null,
      existingValue,
      existingHolderUserId: null,
      existingHolderEmail: null,
      summary: '',
    };
  }

  return {
    hasConflict: true,
    conflictType: 'library_leadership',
    slot: null,
    existingValue,
    existingHolderUserId: null,
    existingHolderEmail: null,
    summary: `Identitas ${label} di Kop Surat saat ini tercatat atas nama "${existingValue}". Peninjau dapat memilih apakah akan memperbarui nama di Kop Surat saat menyetujui akun ini.`,
  };
}

export function resolveMembershipTypeCodeForSignup(params: {
  roleSlug: string;
  gradeLevel?: number | null;
  assignedClass?: string | null;
  memberSubStatus?: string | null;
}): 'SISWA_RENDAH' | 'SISWA_TINGGI' | 'GURU' | 'STAF' | 'KOMITE' | null {
  const role = String(params.roleSlug || '').trim().toLowerCase();
  if (role === 'pengunjung') return null;

  if (role === 'siswa' || role === 'duta_literasi') {
    const grade =
      typeof params.gradeLevel === 'number' && params.gradeLevel >= 1
        ? params.gradeLevel
        : extractGradeLevelFromClassName(params.assignedClass || '');
    return grade <= 3 ? 'SISWA_RENDAH' : 'SISWA_TINGGI';
  }

  if (role === 'komite_sekolah') return 'KOMITE';

  if (
    role === 'wali_kelas' ||
    role === 'guru_pendamping' ||
    role === 'guru_mapel' ||
    role === 'guru_bk' ||
    role === 'kepala_sekolah' ||
    role === 'wakil_kepala_sekolah'
  ) {
    return 'GURU';
  }

  if (role === 'anggota') {
    const sub = String(params.memberSubStatus || '').toLowerCase();
    if (sub.includes('guru') || sub.includes('pendidik')) return 'GURU';
    if (sub.includes('staf') || sub.includes('kependidikan')) return 'STAF';
    if (sub.includes('mitra') || sub.includes('komite')) return 'KOMITE';
    return 'SISWA_TINGGI';
  }

  return 'STAF';
}

export function buildUnitOrClassLabel(
  roleSlug: string,
  assignedClass: string,
  extraMeta: Record<string, string>
): string {
  const slug = String(roleSlug || '').trim().toLowerCase();
  const cls = String(assignedClass || '').trim();

  switch (slug) {
    case 'siswa':
      return cls || 'Siswa';
    case 'duta_literasi':
      return cls
        ? extraMeta.literacyDuty
          ? `${cls} · Duta Literasi (${extraMeta.literacyDuty})`
          : `${cls} · Duta Literasi`
        : 'Duta Literasi';
    case 'wali_kelas':
      return cls ? `Wali ${cls}` : 'Wali Kelas';
    case 'guru_pendamping':
      return cls ? `Pendamping ${cls}` : 'Guru Pendamping';
    case 'guru_mapel':
      return extraMeta.subjectName ? `Guru ${extraMeta.subjectName}` : 'Guru Mata Pelajaran';
    case 'guru_bk':
      return extraMeta.bkScope ? `Guru BK · ${extraMeta.bkScope}` : 'Guru BK / Konselor';
    case 'komite_sekolah': {
      const rel = extraMeta.committeeRelation || 'Komite Sekolah';
      const parts = [rel];
      if (cls) parts.push(`Ortu ${cls}`);
      if (extraMeta.childName) parts.push(extraMeta.childName);
      return parts.join(' · ');
    }
    case 'petugas_kebersihan_keamanan':
      return extraMeta.dutyArea || 'Petugas Kebersihan & Keamanan';
    case 'kepala_sekolah':
      return 'Kepala Sekolah';
    case 'wakil_kepala_sekolah':
      return extraMeta.wakasekField || 'Wakil Kepala Sekolah';
    case 'kepala_perpustakaan':
      return 'Kepala Perpustakaan';
    case 'admin_perpus':
      return extraMeta.serviceShift ? `Admin Perpus · ${extraMeta.serviceShift}` : 'Admin Perpustakaan';
    case 'pustakawan':
      return extraMeta.libraryArea ? `Pustakawan · ${extraMeta.libraryArea}` : 'Pustakawan';
    case 'staff_tu':
      return extraMeta.tuSection ? `TU · ${extraMeta.tuSection}` : 'Staf Tata Usaha';
    case 'bendahara_sekolah':
      return extraMeta.fundScope ? `Bendahara · ${extraMeta.fundScope}` : 'Bendahara Sekolah';
    case 'operator_it':
      return extraMeta.itFocus ? `Operator IT · ${extraMeta.itFocus}` : 'Operator IT';
    case 'anggota': {
      const sub = extraMeta.memberSubStatus || 'Anggota Sekolah';
      return extraMeta.unitLabel ? `${sub} · ${extraMeta.unitLabel}` : sub;
    }
    case 'pengunjung':
      return extraMeta.visitorOrigin || 'Pengunjung Katalog';
    default:
      return cls || 'Warga Sekolah';
  }
}

export function validateRoleSpecificSignupFields(
  input: SignupValidationInput,
  activeClassNames: string[]
): SignupValidationResult {
  const config = getRoleSignupConfig(input.roleSlug);
  const normalizedClass = String(input.assignedClass || '').trim();
  const normalizedIdentity = String(input.identityNumber || '').trim().slice(0, 60);
  const rawGender = String(input.gender || '').trim().toUpperCase();
  const normalizedGender: 'L' | 'P' | '' = rawGender === 'L' || rawGender === 'P' ? rawGender : '';
  const normalizedPhone = String(input.phone || '').trim().slice(0, 32);

  const normalizedExtraMeta: Record<string, string> = {};
  if (input.extraMeta && typeof input.extraMeta === 'object') {
    for (const [k, v] of Object.entries(input.extraMeta)) {
      if (v === undefined || v === null) continue;
      const text = String(v).trim().slice(0, 120);
      if (text) normalizedExtraMeta[k] = text;
    }
  }

  const baseError = (error: string): SignupValidationResult => ({
    valid: false,
    error,
    normalizedClass,
    normalizedUnitOrClass: '',
    normalizedIdentity,
    normalizedGender,
    normalizedPhone,
    normalizedExtraMeta,
  });

  if (config.requiresClassDropdown && !config.classDropdownOptional) {
    if (!normalizedClass) {
      return baseError(`${config.classDropdownLabel} wajib dipilih dari daftar kelas yang tersedia.`);
    }
    if (activeClassNames.length > 0 && !activeClassNames.includes(normalizedClass)) {
      return baseError(
        `Kelas "${normalizedClass}" tidak ditemukan di daftar rombel aktif sekolah. Silakan pilih kelas yang tersedia.`
      );
    }
  } else if (config.requiresClassDropdown && normalizedClass && activeClassNames.length > 0) {
    if (!activeClassNames.includes(normalizedClass)) {
      return baseError(
        `Kelas "${normalizedClass}" tidak terdaftar di daftar rombel aktif sekolah.`
      );
    }
  }

  if (config.identityRequired && !normalizedIdentity) {
    return baseError(`${config.identityFieldLabel} wajib diisi untuk peran ini.`);
  }

  if (config.showGenderField && !normalizedGender) {
    return baseError('Jenis kelamin (Laki-laki / Perempuan) wajib dipilih.');
  }

  for (const field of config.extraFields) {
    const val = normalizedExtraMeta[field.key] || '';
    if (field.required && !val) {
      return baseError(`${field.label} wajib dipilih atau diisi.`);
    }
  }

  const normalizedUnitOrClass = buildUnitOrClassLabel(
    input.roleSlug,
    normalizedClass,
    normalizedExtraMeta
  );

  return {
    valid: true,
    normalizedClass,
    normalizedUnitOrClass,
    normalizedIdentity,
    normalizedGender,
    normalizedPhone,
    normalizedExtraMeta,
  };
}

export function buildRegistrationRequestCode(now: Date = new Date(), randomSuffix?: string): string {
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = (randomSuffix || Math.random().toString(36).slice(2, 6)).toUpperCase().slice(0, 4);
  return `REG-${y}${m}${d}-${suffix}`;
}
