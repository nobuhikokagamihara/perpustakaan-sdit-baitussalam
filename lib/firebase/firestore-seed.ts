'use client';

import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  clampString,
  getFirestoreClient,
  handleFirestoreError,
  OperationType,
} from '@/lib/firebase/client';
import {
  SD_CLASSES,
  buildSeedStudentsForClass,
  getClassPreset,
} from '@/lib/domain/reading-schedule-rules';
import { SCHOOL_ROLE_CATALOG } from '@/lib/domain/settings-backup-rules';

export const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = Object.fromEntries(
  SCHOOL_ROLE_CATALOG.map((r) => [r.slug, r.permissions])
);

export function classNameToDocId(className: string): string {
  const short = className.replace(/^Kelas\s+/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `class_${short || '1a'}`;
}

export const SEED_SCHOOL_CLASSES = SD_CLASSES.map((cls) => {
  const short = cls.className.replace(/^Kelas\s+/i, '').toLowerCase();
  const students = buildSeedStudentsForClass(cls.className).map((st, idx) => ({
    id: `stu_${short}_${String(idx + 1).padStart(2, '0')}`,
    studentCode: st.studentCode,
    fullName: st.fullName,
    gender: st.gender,
    status: 'Aktif' as const,
    notes: '',
    archived: false,
  }));
  return {
    id: classNameToDocId(cls.className),
    className: cls.className,
    gradeLevel: cls.gradeLevel,
    homeroomTeacher: cls.homeroomTeacher,
    companionTeacher: cls.companionTeacher,
    students,
  };
});

function buildSeedSessionAttendance(className: string) {
  const clsDoc = SEED_SCHOOL_CLASSES.find((c) => c.className === className);
  if (!clsDoc) return [];
  return clsDoc.students.map((st, idx) => {
    let status: 'Hadir' | 'Izin' | 'Sakit' | 'Alpa' = 'Hadir';
    let note = '';
    let booksRead = idx < 2 ? 2 : 1;
    if (className === 'Kelas 1A' && idx === 6) {
      status = 'Sakit';
      note = 'Demam ringan (surat orang tua)';
      booksRead = 0;
    } else if (className === 'Kelas 2A' && idx === 4) {
      status = 'Izin';
      note = 'Izin acara keluarga';
      booksRead = 0;
    }
    return {
      studentId: st.id,
      studentCode: st.studentCode,
      studentName: st.fullName,
      status,
      booksRead,
      note,
    };
  });
}

export const SEED_READING_SCHEDULES = [
  {
    id: 'sched_1', numericId: 1, scheduleCode: 'JDW-2026-0001', className: 'Kelas 1A', gradeLevel: 1,
    homeroomTeacher: getClassPreset('Kelas 1A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 1A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Senin',
    startTime: '07:15', endTime: '07:50', roomArea: 'Pojok Baca Karpet', readingMode: 'Membaca Bersama',
    readingTheme: 'Mengenal Fabel Nusantara & Hewan Hutan', bookId: 'book_1', bookNumericId: 1,
    bookTitle: 'Petualangan Kancil di Hutan Nusantara', status: 'Selesai', studentsPresent: 9,
    booksReadCount: 11, sessionNotes: 'Siswa antusias menirukan dialog kancil bersama wali kelas.',
    completedAt: '2026-11-16 07:55:00',
    sessionLogs: [{
      id: 1, sessionDate: '2026-11-16', status: 'Selesai', studentsPresent: 9, booksReadCount: 11,
      notes: 'Siswa antusias menirukan dialog kancil bersama wali kelas.',
      recordedByName: 'Pak Dimas Prasetyo, S.I.Pust.', createdAt: '2026-11-16 07:55:00',
      attendance: buildSeedSessionAttendance('Kelas 1A'),
    }],
  },
  {
    id: 'sched_2', numericId: 2, scheduleCode: 'JDW-2026-0002', className: 'Kelas 1B', gradeLevel: 1,
    homeroomTeacher: getClassPreset('Kelas 1B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 1B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Senin',
    startTime: '08:00', endTime: '08:40', roomArea: 'Pojok Baca Karpet', readingMode: 'Membaca Bersama',
    readingTheme: 'Cerita Bergambar Sikap Jujur & Santun', bookId: 'book_5', bookNumericId: 5,
    bookTitle: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_3', numericId: 3, scheduleCode: 'JDW-2026-0003', className: 'Kelas 2A', gradeLevel: 2,
    homeroomTeacher: getClassPreset('Kelas 2A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 2A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Selasa',
    startTime: '07:15', endTime: '07:50', roomArea: 'Pojok Baca Karpet', readingMode: 'Literasi Pagi',
    readingTheme: 'Membaca Lancar & Kreasi Origami Kertas', bookId: 'book_8', bookNumericId: 8,
    bookTitle: 'Kreasi Origami & Kerajinan Kertas Nusantara', status: 'Selesai', studentsPresent: 9,
    booksReadCount: 11, sessionNotes: 'Siswa antusias membaca dan mempraktikkan lipat perahu kertas.',
    completedAt: '2026-11-17 07:52:00',
    sessionLogs: [{
      id: 2, sessionDate: '2026-11-17', status: 'Selesai', studentsPresent: 9, booksReadCount: 11,
      notes: 'Siswa antusias membaca dan mempraktikkan lipat perahu kertas.',
      recordedByName: 'Pak Dimas Prasetyo, S.I.Pust.', createdAt: '2026-11-17 07:52:00',
      attendance: buildSeedSessionAttendance('Kelas 2A'),
    }],
  },
  {
    id: 'sched_4', numericId: 4, scheduleCode: 'JDW-2026-0004', className: 'Kelas 2B', gradeLevel: 2,
    homeroomTeacher: getClassPreset('Kelas 2B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 2B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Selasa',
    startTime: '08:00', endTime: '08:40', roomArea: 'Pojok Baca Karpet', readingMode: 'Membaca Bersama',
    readingTheme: 'Petualangan Dongeng & Nilai Persahabatan', bookId: 'book_1', bookNumericId: 1,
    bookTitle: 'Petualangan Kancil di Hutan Nusantara', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_5', numericId: 5, scheduleCode: 'JDW-2026-0005', className: 'Kelas 3A', gradeLevel: 3,
    homeroomTeacher: getClassPreset('Kelas 3A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 3A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Rabu',
    startTime: '07:15', endTime: '07:55', roomArea: 'Sudut Sains & Budaya', readingMode: 'Kunjungan Tematik',
    readingTheme: 'Cerita Rakyat dari Sabang sampai Merauke', bookId: 'book_4', bookNumericId: 4,
    bookTitle: 'Kisah Legenda Nusantara: Dari Sabang sampai Merauke', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_6', numericId: 6, scheduleCode: 'JDW-2026-0006', className: 'Kelas 3B', gradeLevel: 3,
    homeroomTeacher: getClassPreset('Kelas 3B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 3B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Rabu',
    startTime: '08:10', endTime: '08:50', roomArea: 'Pojok Baca Karpet', readingMode: 'Membaca Mandiri',
    readingTheme: 'Pendidikan Karakter & Kebiasaan Baik', bookId: 'book_5', bookNumericId: 5,
    bookTitle: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_7', numericId: 7, scheduleCode: 'JDW-2026-0007', className: 'Kelas 4A', gradeLevel: 4,
    homeroomTeacher: getClassPreset('Kelas 4A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 4A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Kamis',
    startTime: '07:15', endTime: '07:55', roomArea: 'Sudut Sains & Budaya', readingMode: 'Kunjungan Tematik',
    readingTheme: 'Pecahan Gembira & Eksperimen IPA Dapur', bookId: 'book_2', bookNumericId: 2,
    bookTitle: 'Matematika Gembira Kelas 4 SD: Pecahan & Bangun Datar', status: 'Berlangsung', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: 'Sesi baca tematik minggu ini didampingi wali kelas.', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_8', numericId: 8, scheduleCode: 'JDW-2026-0008', className: 'Kelas 4B', gradeLevel: 4,
    homeroomTeacher: getClassPreset('Kelas 4B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 4B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Kamis',
    startTime: '08:15', endTime: '08:55', roomArea: 'Sudut Sains & Budaya', readingMode: 'Membaca Mandiri',
    readingTheme: 'Eksplorasi Dunia Hewan Nusantara', bookId: 'book_9', bookNumericId: 9,
    bookTitle: 'Ensiklopedia Bergambar Dunia Hewan Nusantara', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_9', numericId: 9, scheduleCode: 'JDW-2026-0009', className: 'Kelas 5A', gradeLevel: 5,
    homeroomTeacher: getClassPreset('Kelas 5A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 5A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Jumat',
    startTime: '07:15', endTime: '07:55', roomArea: 'Meja Referensi & Kamus', readingMode: 'Literasi Pagi',
    readingTheme: 'Aku Suka Membaca & Menulis Ringkasan', bookId: 'book_6', bookNumericId: 6,
    bookTitle: 'Bahasa Indonesia Kelas 5 SD: Aku Suka Membaca', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_10', numericId: 10, scheduleCode: 'JDW-2026-0010', className: 'Kelas 5B', gradeLevel: 5,
    homeroomTeacher: getClassPreset('Kelas 5B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 5B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Jumat',
    startTime: '08:15', endTime: '08:55', roomArea: 'Sudut Sains & Budaya', readingMode: 'Diskusi & Resensi',
    readingTheme: 'Mengenal Tata Surya & Planet', bookId: 'book_3', bookNumericId: 3,
    bookTitle: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_11', numericId: 11, scheduleCode: 'JDW-2026-0011', className: 'Kelas 6A', gradeLevel: 6,
    homeroomTeacher: getClassPreset('Kelas 6A')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 6A')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Sabtu',
    startTime: '08:00', endTime: '08:45', roomArea: 'Meja Referensi & Kamus', readingMode: 'Diskusi & Resensi',
    readingTheme: 'Bedah Kamus Dwibahasa & Literasi Ujian', bookId: 'book_10', bookNumericId: 10,
    bookTitle: 'Kamus Bergambar Bahasa Indonesia–Inggris SD', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
  {
    id: 'sched_12', numericId: 12, scheduleCode: 'JDW-2026-0012', className: 'Kelas 6B', gradeLevel: 6,
    homeroomTeacher: getClassPreset('Kelas 6B')!.homeroomTeacher,
    companionTeacher: getClassPreset('Kelas 6B')!.companionTeacher,
    studentCount: 10, dayOfWeek: 'Sabtu',
    startTime: '09:00', endTime: '09:45', roomArea: 'Teras Baca Taman', readingMode: 'Diskusi & Resensi',
    readingTheme: 'Resensi Legenda Nusantara & Presentasi Kelompok', bookId: 'book_4', bookNumericId: 4,
    bookTitle: 'Kisah Legenda Nusantara: Dari Sabang sampai Merauke', status: 'Terjadwal', studentsPresent: 0,
    booksReadCount: 0, sessionNotes: '', completedAt: '', sessionLogs: [],
  },
];

let seedPromise: Promise<void> | null = null;

export async function ensureFirestoreSeeded(
  staffUid: string,
  staffName: string
): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = runSeedIfNeeded(staffUid, staffName).finally(() => {
    seedPromise = null;
  });
  return seedPromise;
}

async function runSeedIfNeeded(staffUid: string, staffName: string): Promise<void> {
  const db = getFirestoreClient();
  const settingsRef = doc(db, 'library_settings', 'global');
  let snap;
  try {
    snap = await getDoc(settingsRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'library_settings/global');
  }

  if (snap.exists() && snap.data()?.seeded === true) {
    return;
  }

  const safeUid = clampString(staffUid, 128, 'system');
  const safeName = clampString(staffName, 120, 'Operator Sekolah');
  const batch = writeBatch(db);

  // 1. Settings & RBAC
  batch.set(settingsRef, {
    kind: 'global',
    seeded: true,
    values: {
      library_name: 'Perpustakaan SD Lentera Pustaka',
      library_tagline: 'Taman Baca & Pusat Literasi Siswa Sekolah Dasar',
      library_address: 'Jl. Tamansari No. 42, Bandung 40132',
      library_phone: '(022) 250-4812',
      library_email: 'perpustakaan@sdlenterapustaka.sch.id',
      operating_hours: 'Senin–Jumat 07:00–14:30 | Sabtu 08:00–12:00',
      grace_period_days: '1',
      default_damage_fee_percent: '50',
      allow_partial_fine_payment: 'true',
      allow_overdue_renewal: 'false',
      block_on_unpaid_fines_limit: '20000',
      reservation_pickup_hours: '48',
      member_code_prefix: 'AGT-2026-',
      inventory_code_prefix: 'LP-2026-',
      policy_application_mode: 'new_transactions_only',
      notify_due_days_before: '2',
    },
    updatedByUid: safeUid,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'library_settings', 'rbac'), {
    kind: 'rbac',
    seeded: true,
    rolePermissions: ROLE_PERMISSION_DEFAULTS,
    updatedByUid: safeUid,
    updatedAt: serverTimestamp(),
  });

  // 2. Membership Types (SD)
  const mTypes = [
    { id: 'mtype_1', numericId: 1, code: 'SISWA_RENDAH', name: 'Siswa Kelas 1–3', maxLoans: 2, loanDurationDays: 7, maxRenewals: 1, dailyFineRate: 500, maxFineCap: 10000, allowReservation: true },
    { id: 'mtype_2', numericId: 2, code: 'SISWA_TINGGI', name: 'Siswa Kelas 4–6', maxLoans: 3, loanDurationDays: 7, maxRenewals: 1, dailyFineRate: 500, maxFineCap: 15000, allowReservation: true },
    { id: 'mtype_3', numericId: 3, code: 'GURU', name: 'Guru & Wali Kelas', maxLoans: 6, loanDurationDays: 14, maxRenewals: 2, dailyFineRate: 500, maxFineCap: 20000, allowReservation: true },
    { id: 'mtype_4', numericId: 4, code: 'STAF', name: 'Staf & Tata Usaha', maxLoans: 4, loanDurationDays: 14, maxRenewals: 2, dailyFineRate: 500, maxFineCap: 20000, allowReservation: true },
    { id: 'mtype_5', numericId: 5, code: 'KOMITE', name: 'Orang Tua / Komite Sekolah', maxLoans: 2, loanDurationDays: 7, maxRenewals: 1, dailyFineRate: 1000, maxFineCap: 25000, allowReservation: true },
  ];
  for (const mt of mTypes) {
    const { id, ...rest } = mt;
    batch.set(doc(db, 'membership_types', id), { ...rest, updatedAt: serverTimestamp() });
  }

  // 3. Categories
  const categories = [
    { id: 'cat_1', numericId: 1, code: '808', name: 'Cerita Anak & Dongeng' },
    { id: 'cat_2', numericId: 2, code: '372', name: 'Buku Pelajaran & Tematik' },
    { id: 'cat_3', numericId: 3, code: '500', name: 'Sains & Eksperimen Anak' },
    { id: 'cat_4', numericId: 4, code: '959', name: 'Sejarah & Budaya Indonesia' },
    { id: 'cat_5', numericId: 5, code: '170', name: 'Budi Pekerti & Karakter' },
    { id: 'cat_6', numericId: 6, code: '700', name: 'Keterampilan & Kesenian' },
  ];
  for (const c of categories) {
    batch.set(doc(db, 'categories', c.id), {
      numericId: c.numericId,
      code: c.code,
      name: c.name,
      createdAt: serverTimestamp(),
    });
  }

  // 4. Locations & Shelves
  const locations = [
    { id: 'loc_1', numericId: 1, code: 'GD-SD1', building: 'Gedung Perpustakaan SD', floor: 'Lantai 1', room: 'Pojok Baca & Koleksi Utama', description: 'Area baca karpet warna-warni, buku cerita bergambar, dan buku paket tematik' },
    { id: 'loc_2', numericId: 2, code: 'GD-SD2', building: 'Gedung Perpustakaan SD', floor: 'Lantai 1', room: 'Sudut Sains & Budaya Nusantara', description: 'Rak buku eksperimen sains anak, sejarah pahlawan, dan cerita rakyat' },
    { id: 'loc_3', numericId: 3, code: 'GD-REF', building: 'Gedung Perpustakaan SD', floor: 'Lantai 1', room: 'Meja Referensi & Kamus Bergambar', description: 'Koleksi ensiklopedia anak dan kamus khusus baca di tempat' },
  ];
  for (const l of locations) {
    const { id, ...rest } = l;
    batch.set(doc(db, 'locations', id), { ...rest, createdAt: serverTimestamp() });
  }

  const shelves = [
    { id: 'shelf_1', numericId: 1, locationId: 'loc_1', code: 'R-CRT-01', name: 'Rak Cerita Anak & Fabel', capacity: 180, building: 'Gedung Perpustakaan SD', room: 'Pojok Baca & Koleksi Utama' },
    { id: 'shelf_2', numericId: 2, locationId: 'loc_1', code: 'R-PKT-01', name: 'Rak Buku Pelajaran & Tematik SD', capacity: 200, building: 'Gedung Perpustakaan SD', room: 'Pojok Baca & Koleksi Utama' },
    { id: 'shelf_3', numericId: 3, locationId: 'loc_2', code: 'R-SAI-01', name: 'Rak Sains & Eksperimen Cilik', capacity: 150, building: 'Gedung Perpustakaan SD', room: 'Sudut Sains & Budaya Nusantara' },
    { id: 'shelf_4', numericId: 4, locationId: 'loc_2', code: 'R-BDY-01', name: 'Rak Budaya, Sejarah & Budi Pekerti', capacity: 150, building: 'Gedung Perpustakaan SD', room: 'Sudut Sains & Budaya Nusantara' },
    { id: 'shelf_5', numericId: 5, locationId: 'loc_3', code: 'R-REF-01', name: 'Rak Ensiklopedia & Kamus SD', capacity: 100, building: 'Gedung Perpustakaan SD', room: 'Meja Referensi & Kamus Bergambar' },
  ];
  for (const s of shelves) {
    const { id, ...rest } = s;
    batch.set(doc(db, 'shelves', id), { ...rest, createdAt: serverTimestamp() });
  }

  // 5. Books, Public Catalog, and Book Copies
  const booksSeed = [
    { numericId: 1, title: 'Petualangan Kancil di Hutan Nusantara', isbn: '978-602-291-001-1', edition: 'Cetakan 3 Bergambar', publishYear: 2024, language: 'Indonesia', description: 'Kumpulan fabel jenaka tentang kecerdikan Kancil menolong sahabat-sahabatnya di hutan tropis, dilengkapi pesan moral persahabatan untuk siswa kelas 1–4 SD.', pages: 72, coverUrl: '/images/cover-cerita-anak.jpg', price: 55000, categoryId: 'cat_1', categoryName: 'Cerita Anak & Dongeng', publisherName: 'Mizan Pelangi', authors: 'Kak Bimo & Tim Literasi', subcategory: 'Fabel & Dongeng Anak', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_1', shelfCode: 'R-CRT-01', shelfName: 'Rak Cerita Anak & Fabel', copies: 4, borrowCount: 2 },
    { numericId: 2, title: 'Matematika Gembira Kelas 4 SD: Pecahan & Bangun Datar', isbn: '978-602-291-002-8', edition: 'Kurikulum Merdeka', publishYear: 2025, language: 'Indonesia', description: 'Buku pendamping belajar berhitung dengan ilustrasi benda sehari-hari, permainan teka-teki angka, dan latihan soal bertahap untuk kelas 4 SD.', pages: 148, coverUrl: '/images/cover-pelajaran-sd.jpg', price: 68000, categoryId: 'cat_2', categoryName: 'Buku Pelajaran & Tematik', publisherName: 'Kemendikbudristek', authors: 'Tim Kurikulum Merdeka SD', subcategory: 'Matematika SD', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_2', shelfCode: 'R-PKT-01', shelfName: 'Rak Buku Pelajaran & Tematik SD', copies: 4, borrowCount: 1 },
    { numericId: 3, title: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak', isbn: '978-602-412-003-5', edition: 'Cetakan 2 Full Color', publishYear: 2025, language: 'Indonesia', description: 'Mengajak siswa SD menjelajahi delapan planet, fase bulan, dan roket antariksa dengan bahasa sederhana serta infografis penuh warna.', pages: 96, coverUrl: '/images/cover-sains-sd.jpg', price: 85000, categoryId: 'cat_3', categoryName: 'Sains & Eksperimen Anak', publisherName: 'Erlangga for Kids', authors: 'Dr. Yohanes Surya & Tim', subcategory: 'Astronomi Anak', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_3', shelfCode: 'R-SAI-01', shelfName: 'Rak Sains & Eksperimen Cilik', copies: 3, borrowCount: 2 },
    { numericId: 4, title: 'Kisah Legenda Nusantara: Dari Sabang sampai Merauke', isbn: '978-979-973-004-2', edition: 'Edisi Ilustrasi', publishYear: 2023, language: 'Indonesia', description: 'Antologi cerita rakyat pilihan seperti Danau Toba, Malin Kundang, dan Cendrawasih yang menumbuhkan cinta tanah air bagi pembaca cilik.', pages: 112, coverUrl: '/images/cover-budaya-sd.jpg', price: 72000, categoryId: 'cat_4', categoryName: 'Sejarah & Budaya Indonesia', publisherName: 'Bhuana Ilmu Populer', authors: 'Watiek Ideo', subcategory: 'Cerita Rakyat Indonesia', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_4', shelfCode: 'R-BDY-01', shelfName: 'Rak Budaya, Sejarah & Budi Pekerti', copies: 3, borrowCount: 1 },
    { numericId: 5, title: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian', isbn: '978-979-461-005-9', edition: 'Cetakan 5', publishYear: 2024, language: 'Indonesia', description: 'Kisah-kisah ringan di lingkungan sekolah dasar tentang sikap jujur, antre tertib, saling membantu, dan menjaga kebersihan kelas.', pages: 64, coverUrl: '/images/cover-cerita-anak.jpg', price: 48000, categoryId: 'cat_5', categoryName: 'Budi Pekerti & Karakter', publisherName: 'Tiga Serangkai', authors: 'Nadia R. Utami', subcategory: 'Pendidikan Karakter', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_4', shelfCode: 'R-BDY-01', shelfName: 'Rak Budaya, Sejarah & Budi Pekerti', copies: 3, borrowCount: 1 },
    { numericId: 6, title: 'Bahasa Indonesia Kelas 5 SD: Aku Suka Membaca', isbn: '978-602-433-006-6', edition: 'Kurikulum Merdeka', publishYear: 2024, language: 'Indonesia', description: 'Panduan membaca pemahaman, menulis puisi sederhana, menyusun laporan pengamatan, dan berdiskusi santun di kelas.', pages: 164, coverUrl: '/images/cover-pelajaran-sd.jpg', price: 62000, categoryId: 'cat_2', categoryName: 'Buku Pelajaran & Tematik', publisherName: 'Kemendikbudristek', authors: 'Tim Kurikulum Merdeka SD', subcategory: 'Bahasa Indonesia SD', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_2', shelfCode: 'R-PKT-01', shelfName: 'Rak Buku Pelajaran & Tematik SD', copies: 3, borrowCount: 0 },
    { numericId: 7, title: '15 Eksperimen Sains Seru dari Dapur Rumah', isbn: '978-602-291-007-3', edition: 'Cetakan 1', publishYear: 2025, language: 'Indonesia', description: 'Panduan praktik sains aman untuk siswa kelas 3–6 SD menggunakan bahan dapur seperti gunung berapi soda kue dan pelangi gelas.', pages: 88, coverUrl: '/images/cover-sains-sd.jpg', price: 78000, categoryId: 'cat_3', categoryName: 'Sains & Eksperimen Anak', publisherName: 'Erlangga for Kids', authors: 'Rizki Pratama', subcategory: 'Praktik IPA SD', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_3', shelfCode: 'R-SAI-01', shelfName: 'Rak Sains & Eksperimen Cilik', copies: 2, borrowCount: 1 },
    { numericId: 8, title: 'Kreasi Origami & Kerajinan Kertas Nusantara', isbn: '978-979-229-008-0', edition: 'Cetakan 4', publishYear: 2024, language: 'Indonesia', description: 'Langkah demi langkah melipat kertas menjadi hewan, perahu pinisi, dan hiasan dinding untuk melatih motorik halus siswa SD.', pages: 80, coverUrl: '/images/cover-budaya-sd.jpg', price: 54000, categoryId: 'cat_6', categoryName: 'Keterampilan & Kesenian', publisherName: 'Bhuana Ilmu Populer', authors: 'Dewi Lestari Sari', subcategory: 'Prakarya & Seni', isReferenceOnly: false, readInPlaceOnly: false, shelfId: 'shelf_1', shelfCode: 'R-CRT-01', shelfName: 'Rak Cerita Anak & Fabel', copies: 2, borrowCount: 0 },
    { numericId: 9, title: 'Ensiklopedia Bergambar Dunia Hewan Nusantara', isbn: '978-602-433-009-7', edition: 'Edisi Referensi Sekolah', publishYear: 2024, language: 'Indonesia', description: 'Ensiklopedia hardcover penuh ilustrasi mengenai komodo, orangutan, badak bercula satu, dan burung cenderawasih. Khusus koleksi referensi baca di tempat.', pages: 224, coverUrl: '/images/cover-sains-sd.jpg', price: 195000, categoryId: 'cat_3', categoryName: 'Sains & Eksperimen Anak', publisherName: 'Erlangga for Kids', authors: 'Tim Ensiklopedia Cilik', subcategory: 'Ensiklopedia Anak', isReferenceOnly: true, readInPlaceOnly: true, shelfId: 'shelf_5', shelfCode: 'R-REF-01', shelfName: 'Rak Ensiklopedia & Kamus SD', copies: 2, borrowCount: 0 },
    { numericId: 10, title: 'Kamus Bergambar Bahasa Indonesia–Inggris SD', isbn: '978-602-412-010-3', edition: 'Edisi Meja Referensi', publishYear: 2023, language: 'Indonesia / Inggris', description: 'Kamus tematik dengan 1.500 kosakata bergambar untuk siswa sekolah dasar. Koleksi referensi khusus dibaca di ruang perpustakaan.', pages: 260, coverUrl: '/images/cover-pelajaran-sd.jpg', price: 160000, categoryId: 'cat_2', categoryName: 'Buku Pelajaran & Tematik', publisherName: 'Bhuana Ilmu Populer', authors: 'Tim Ensiklopedia Cilik', subcategory: 'Kamus Sekolah', isReferenceOnly: true, readInPlaceOnly: true, shelfId: 'shelf_5', shelfCode: 'R-REF-01', shelfName: 'Rak Ensiklopedia & Kamus SD', copies: 2, borrowCount: 0 },
  ];

  // Copies actively borrowed in seed loans:
  // copy_2 (book 1), copy_5 (book 2), copy_10 (book 3), copy_12 (book 4), copy_21 (book 7)
  const borrowedCopyNums = new Set([2, 5, 10, 12, 21]);
  let copySeq = 1;

  for (const b of booksSeed) {
    const bookDocId = `book_${b.numericId}`;
    let availForBook = 0;
    for (let i = 0; i < b.copies; i++) {
      const cNum = copySeq;
      const copyDocId = `copy_${cNum}`;
      const isBorrowed = borrowedCopyNums.has(cNum);
      if (!isBorrowed) availForBook++;
      batch.set(doc(db, 'book_copies', copyDocId), {
        numericId: cNum,
        bookId: bookDocId,
        bookTitle: b.title,
        inventoryCode: `LP-2026-${String(cNum).padStart(4, '0')}`,
        barcode: `BC${String(20260000 + cNum)}`,
        shelfId: b.shelfId,
        shelfCode: b.shelfCode,
        shelfName: b.shelfName,
        condition: 'Baik',
        status: isBorrowed ? 'Dipinjam' : 'Tersedia',
        acquisitionDate: '2026-07-15',
        price: b.price,
        notes: '',
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      copySeq++;
    }

    batch.set(doc(db, 'books', bookDocId), {
      numericId: b.numericId,
      title: b.title,
      isbn: b.isbn,
      edition: b.edition,
      publishYear: b.publishYear,
      language: b.language,
      description: b.description,
      pages: b.pages,
      coverUrl: b.coverUrl,
      price: b.price,
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      publisherName: b.publisherName,
      authors: b.authors,
      subcategory: b.subcategory,
      isReferenceOnly: b.isReferenceOnly,
      readInPlaceOnly: b.readInPlaceOnly,
      acquisitionDate: '2026-07-15',
      borrowCount: b.borrowCount,
      archived: false,
      createdByUid: safeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'public_catalog', bookDocId), {
      numericId: b.numericId,
      title: b.title,
      isbn: b.isbn,
      edition: b.edition,
      publishYear: b.publishYear,
      language: b.language,
      description: b.description,
      pages: b.pages,
      coverUrl: b.coverUrl,
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      publisherName: b.publisherName,
      authors: b.authors,
      subcategory: b.subcategory,
      isReferenceOnly: b.isReferenceOnly,
      readInPlaceOnly: b.readInPlaceOnly,
      totalCopies: b.copies,
      availableCopies: availForBook,
      shelfLocations: `${b.shelfCode} (${b.shelfName})`,
      borrowCount: b.borrowCount,
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 6. Members (SD Students, Teachers, Staff, Committee)
  const membersSeed = [
    { id: 'member_1', numericId: 1, memberCode: 'AGT-2026-0001', fullName: 'Bima Pratama Putra', membershipTypeId: 'mtype_2', membershipTypeName: 'Siswa Kelas 4–6', identityNumber: '0154829101', gender: 'Laki-laki', unitOrClass: 'Kelas 5A', address: 'Jl. Melati No. 14, Kec. Coblong, Bandung', phone: '081234567801', email: 'anggota@lenterapustaka.id', registeredAt: '2026-07-14', expiresAt: '2027-07-14', status: 'Aktif', blockReason: '' },
    { id: 'member_2', numericId: 2, memberCode: 'AGT-2026-0002', fullName: 'Ibu Nadia Kusuma, S.Pd.', membershipTypeId: 'mtype_3', membershipTypeName: 'Guru & Wali Kelas', identityNumber: '198808242014022001', gender: 'Perempuan', unitOrClass: 'Wali Kelas 4A', address: 'Jl. Dago Asri No. 22, Bandung', phone: '081234567802', email: 'nadia.kusuma@lenterapustaka.id', registeredAt: '2026-07-14', expiresAt: '2027-07-14', status: 'Aktif', blockReason: '' },
    { id: 'member_3', numericId: 3, memberCode: 'AGT-2026-0003', fullName: 'Alya Putri Azzahra', membershipTypeId: 'mtype_1', membershipTypeName: 'Siswa Kelas 1–3', identityNumber: '0173920412', gender: 'Perempuan', unitOrClass: 'Kelas 2B', address: 'Jl. Riau No. 88, Bandung', phone: '081234567803', email: 'ortu.alya@mail.id', registeredAt: '2026-07-15', expiresAt: '2027-07-15', status: 'Aktif', blockReason: '' },
    { id: 'member_4', numericId: 4, memberCode: 'AGT-2026-0004', fullName: 'Siti Rahmawati', membershipTypeId: 'mtype_2', membershipTypeName: 'Siswa Kelas 4–6', identityNumber: '0149928173', gender: 'Perempuan', unitOrClass: 'Kelas 6B', address: 'Jl. Cihampelas No. 51, Bandung', phone: '081234567804', email: 'siti.rahma@mail.id', registeredAt: '2026-07-15', expiresAt: '2027-07-15', status: 'Aktif', blockReason: '' },
    { id: 'member_5', numericId: 5, memberCode: 'AGT-2026-0005', fullName: 'Pak Hendra Gunawan, S.Pd.', membershipTypeId: 'mtype_3', membershipTypeName: 'Guru & Wali Kelas', identityNumber: '198205022010011008', gender: 'Laki-laki', unitOrClass: 'Guru IPA & Sains SD', address: 'Jl. Setiabudi No. 102, Bandung', phone: '081234567805', email: 'hendra.g@mail.id', registeredAt: '2026-07-16', expiresAt: '2027-07-16', status: 'Aktif', blockReason: '' },
    { id: 'member_6', numericId: 6, memberCode: 'AGT-2026-0006', fullName: 'Dewi Anggraini', membershipTypeId: 'mtype_4', membershipTypeName: 'Staf & Tata Usaha', identityNumber: '199007512018032004', gender: 'Perempuan', unitOrClass: 'Tata Usaha Sekolah', address: 'Jl. Dipatiukur No. 9, Bandung', phone: '081234567806', email: 'dewi.anggraini@lenterapustaka.id', registeredAt: '2025-11-25', expiresAt: '2026-11-25', status: 'Aktif', blockReason: '' },
    { id: 'member_7', numericId: 7, memberCode: 'AGT-2026-0007', fullName: 'Fajar Nugroho', membershipTypeId: 'mtype_2', membershipTypeName: 'Siswa Kelas 4–6', identityNumber: '0148810293', gender: 'Laki-laki', unitOrClass: 'Kelas 6A', address: 'Jl. Sukajadi No. 33, Bandung', phone: '081234567807', email: 'ortu.fajar@mail.id', registeredAt: '2026-07-20', expiresAt: '2027-07-20', status: 'Diblokir', blockReason: 'Menunggak pengembalian buku cerita lebih dari 14 hari' },
    { id: 'member_8', numericId: 8, memberCode: 'AGT-2026-0008', fullName: 'Tari Melati (Komite)', membershipTypeId: 'mtype_5', membershipTypeName: 'Orang Tua / Komite Sekolah', identityNumber: '3273084412890008', gender: 'Perempuan', unitOrClass: 'Komite Kelas 3A', address: 'Jl. Tubagus Ismail No. 7, Bandung', phone: '081234567808', email: 'tari.melati@mail.id', registeredAt: '2025-10-01', expiresAt: '2026-10-01', status: 'Nonaktif', blockReason: '' },
  ];
  for (const m of membersSeed) {
    const { id, ...rest } = m;
    batch.set(doc(db, 'members', id), {
      ...rest,
      ownerUid: '',
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 7. Loans (3 historical, 4 active including 1 overdue)
  const loansSeed = [
    {
      id: 'loan_1', numericId: 1, loanNumber: 'PJM-2026-0001', idempotencyKey: 'seed-l1',
      memberId: 'member_1', memberCode: 'AGT-2026-0001', memberName: 'Bima Pratama Putra',
      loanDate: '2026-10-18', dueDate: '2026-10-25', maxRenewals: 1, status: 'Selesai',
      notes: 'Bacaan pojok literasi kelas 5A',
      items: [{ id: 1, copyId: 'copy_1', inventoryCode: 'LP-2026-0001', bookTitle: 'Petualangan Kancil di Hutan Nusantara', dueDate: '2026-10-25', returnedAt: '2026-10-24', status: 'Dikembalikan', renewalCount: 0, returnCondition: 'Baik' }],
    },
    {
      id: 'loan_2', numericId: 2, loanNumber: 'PJM-2026-0002', idempotencyKey: 'seed-l2',
      memberId: 'member_3', memberCode: 'AGT-2026-0003', memberName: 'Alya Putri Azzahra',
      loanDate: '2026-10-20', dueDate: '2026-10-27', maxRenewals: 1, status: 'Selesai', notes: '',
      items: [{ id: 2, copyId: 'copy_9', inventoryCode: 'LP-2026-0009', bookTitle: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak', dueDate: '2026-10-27', returnedAt: '2026-10-30', status: 'Dikembalikan', renewalCount: 0, returnCondition: 'Baik' }],
    },
    {
      id: 'loan_3', numericId: 3, loanNumber: 'PJM-2026-0003', idempotencyKey: 'seed-l3',
      memberId: 'member_4', memberCode: 'AGT-2026-0004', memberName: 'Siti Rahmawati',
      loanDate: '2026-11-05', dueDate: '2026-11-12', maxRenewals: 1, status: 'Selesai', notes: '',
      items: [{ id: 3, copyId: 'copy_15', inventoryCode: 'LP-2026-0015', bookTitle: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian', dueDate: '2026-11-12', returnedAt: '2026-11-12', status: 'Dikembalikan', renewalCount: 0, returnCondition: 'Baik' }],
    },
    {
      id: 'loan_4', numericId: 4, loanNumber: 'PJM-2026-0004', idempotencyKey: 'seed-l4',
      memberId: 'member_1', memberCode: 'AGT-2026-0001', memberName: 'Bima Pratama Putra',
      loanDate: '2026-11-15', dueDate: '2026-11-22', maxRenewals: 1, status: 'Aktif', notes: 'Tugas merangkum cerita anak',
      items: [
        { id: 4, copyId: 'copy_2', inventoryCode: 'LP-2026-0002', bookTitle: 'Petualangan Kancil di Hutan Nusantara', dueDate: '2026-11-22', returnedAt: null, status: 'Dipinjam', renewalCount: 0, returnCondition: null },
        { id: 5, copyId: 'copy_5', inventoryCode: 'LP-2026-0005', bookTitle: 'Matematika Gembira Kelas 4 SD: Pecahan & Bangun Datar', dueDate: '2026-11-22', returnedAt: null, status: 'Dipinjam', renewalCount: 0, returnCondition: null },
      ],
    },
    {
      id: 'loan_5', numericId: 5, loanNumber: 'PJM-2026-0005', idempotencyKey: 'seed-l5',
      memberId: 'member_2', memberCode: 'AGT-2026-0002', memberName: 'Ibu Nadia Kusuma, S.Pd.',
      loanDate: '2026-11-14', dueDate: '2026-11-28', maxRenewals: 2, status: 'Aktif', notes: 'Materi pembelajaran IPA kelas 4A',
      items: [{ id: 6, copyId: 'copy_21', inventoryCode: 'LP-2026-0021', bookTitle: '15 Eksperimen Sains Seru dari Dapur Rumah', dueDate: '2026-11-28', returnedAt: null, status: 'Dipinjam', renewalCount: 0, returnCondition: null }],
    },
    {
      id: 'loan_6', numericId: 6, loanNumber: 'PJM-2026-0006', idempotencyKey: 'seed-l6',
      memberId: 'member_7', memberCode: 'AGT-2026-0007', memberName: 'Fajar Nugroho',
      loanDate: '2026-11-03', dueDate: '2026-11-10', maxRenewals: 1, status: 'Terlambat', notes: 'Sudah diingatkan lewat wali kelas',
      items: [{ id: 7, copyId: 'copy_12', inventoryCode: 'LP-2026-0012', bookTitle: 'Kisah Legenda Nusantara: Dari Sabang sampai Merauke', dueDate: '2026-11-10', returnedAt: null, status: 'Terlambat', renewalCount: 0, returnCondition: null }],
    },
    {
      id: 'loan_7', numericId: 7, loanNumber: 'PJM-2026-0007', idempotencyKey: 'seed-l7',
      memberId: 'member_5', memberCode: 'AGT-2026-0005', memberName: 'Pak Hendra Gunawan, S.Pd.',
      loanDate: '2026-11-17', dueDate: '2026-12-01', maxRenewals: 2, status: 'Aktif', notes: 'Persiapan proyek sains siswa',
      items: [{ id: 8, copyId: 'copy_10', inventoryCode: 'LP-2026-0010', bookTitle: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak', dueDate: '2026-12-01', returnedAt: null, status: 'Dipinjam', renewalCount: 0, returnCondition: null }],
    },
  ];
  for (const l of loansSeed) {
    const { id, ...rest } = l;
    batch.set(doc(db, 'loans', id), {
      ...rest,
      ownerUid: '',
      staffUid: safeUid,
      staffName: safeName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 8. Returns
  const returnsSeed = [
    { id: 'ret_1', numericId: 1, returnNumber: 'KMB-2026-0001', loanId: 'loan_1', loanNumber: 'PJM-2026-0001', copyId: 'copy_1', inventoryCode: 'LP-2026-0001', bookTitle: 'Petualangan Kancil di Hutan Nusantara', memberId: 'member_1', memberName: 'Bima Pratama Putra', returnedAt: '2026-10-24', condition: 'Baik', status: 'Tepat Waktu', overdueDays: 0, fineAmount: 0, notes: '' },
    { id: 'ret_2', numericId: 2, returnNumber: 'KMB-2026-0002', loanId: 'loan_2', loanNumber: 'PJM-2026-0002', copyId: 'copy_9', inventoryCode: 'LP-2026-0009', bookTitle: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak', memberId: 'member_3', memberName: 'Alya Putri Azzahra', returnedAt: '2026-10-30', condition: 'Baik', status: 'Terlambat', overdueDays: 3, fineAmount: 1500, notes: 'Terlambat 3 hari' },
    { id: 'ret_3', numericId: 3, returnNumber: 'KMB-2026-0003', loanId: 'loan_3', loanNumber: 'PJM-2026-0003', copyId: 'copy_15', inventoryCode: 'LP-2026-0015', bookTitle: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian', memberId: 'member_4', memberName: 'Siti Rahmawati', returnedAt: '2026-11-12', condition: 'Baik', status: 'Tepat Waktu', overdueDays: 0, fineAmount: 0, notes: '' },
  ];
  for (const r of returnsSeed) {
    const { id, ...rest } = r;
    batch.set(doc(db, 'returns', id), {
      ...rest,
      ownerUid: '',
      staffUid: safeUid,
      createdAt: serverTimestamp(),
    });
  }

  // 9. Fines & Payments
  batch.set(doc(db, 'fines', 'fine_1'), {
    numericId: 1, fineNumber: 'DND-2026-0001', memberId: 'member_3', memberCode: 'AGT-2026-0003', memberName: 'Alya Putri Azzahra',
    ownerUid: '', loanId: 'loan_2', loanNumber: 'PJM-2026-0002', returnId: 'ret_2', fineType: 'Keterlambatan',
    amount: 1500, paidAmount: 1500, waivedAmount: 0, status: 'Lunas', reason: 'Terlambat 3 hari (KMB-2026-0002)',
    createdByUid: safeUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'fines', 'fine_2'), {
    numericId: 2, fineNumber: 'DND-2026-0002', memberId: 'member_7', memberCode: 'AGT-2026-0007', memberName: 'Fajar Nugroho',
    ownerUid: '', loanId: '', loanNumber: '', returnId: '', fineType: 'Kerusakan',
    amount: 15000, paidAmount: 0, waivedAmount: 0, status: 'Belum Lunas', reason: 'Sampul buku robek pada peminjaman sebelumnya',
    createdByUid: safeUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'payments', 'pay_1'), {
    numericId: 1, paymentNumber: 'BYR-2026-0001', fineId: 'fine_1', fineNumber: 'DND-2026-0001',
    memberId: 'member_3', memberCode: 'AGT-2026-0003', memberName: 'Alya Putri Azzahra', ownerUid: '',
    amount: 1500, method: 'Tunai', receivedByUid: safeUid, receivedByName: safeName,
    paidAt: '2026-10-30 10:15:00', notes: 'Dibayar tunai di meja pustakawan', createdAt: serverTimestamp(),
  });

  // 10. Reservations
  batch.set(doc(db, 'reservations', 'res_1'), {
    numericId: 1, reservationNumber: 'RSV-2026-0001', bookId: 'book_1', bookTitle: 'Petualangan Kancil di Hutan Nusantara',
    isbn: '978-602-291-001-1', copyId: '', inventoryCode: '', memberId: 'member_4', memberCode: 'AGT-2026-0004', memberName: 'Siti Rahmawati',
    ownerUid: '', queuePosition: 1, status: 'Menunggu', reservedAt: '2026-11-16 09:30:00', expiresAt: '',
    notes: 'Untuk kegiatan literasi pagi kelas 6B', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'reservations', 'res_2'), {
    numericId: 2, reservationNumber: 'RSV-2026-0002', bookId: 'book_3', bookTitle: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak',
    isbn: '978-602-412-003-5', copyId: '', inventoryCode: '', memberId: 'member_5', memberCode: 'AGT-2026-0005', memberName: 'Pak Hendra Gunawan, S.Pd.',
    ownerUid: '', queuePosition: 1, status: 'Menunggu', reservedAt: '2026-11-17 10:15:00', expiresAt: '',
    notes: 'Dipinjam untuk alat bantu ajar tata surya', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  // 11. Suppliers & Acquisitions
  batch.set(doc(db, 'suppliers', 'sup_1'), {
    numericId: 1, code: 'SUP-001', name: 'CV Pustaka Edukasi Anak', contactPerson: 'Bagus Setiawan',
    phone: '022-4231990', email: 'order@pustakaedukasi.co.id', address: 'Jl. Merdeka No. 45, Bandung', createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'suppliers', 'sup_2'), {
    numericId: 2, code: 'SUP-002', name: 'PT Aksara Sekolah Nusantara', contactPerson: 'Lina Marlina',
    phone: '021-5790221', email: 'sales@aksarasekolah.co.id', address: 'Jl. Sudirman Kav. 12, Jakarta', createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'acquisitions', 'acq_1'), {
    numericId: 1, requestNumber: 'PGD-2026-0001', titleSummary: 'Pengadaan Buku Cerita Bergambar & Literasi Kelas 1–3',
    supplierId: 'sup_1', supplierName: 'CV Pustaka Edukasi Anak', requestedByUid: safeUid, requestedByName: safeName,
    approvedByUid: safeUid, approvedByName: 'Kepala Perpustakaan', orderDate: '2026-11-01', receivedDate: '2026-11-10',
    totalEstimatedCost: 620000, status: 'Selesai', notes: 'Diterima lengkap dan telah disusun di pojok baca',
    items: [
      { id: 1, title: 'Seri Aku Suka Membaca: Sahabat Hutan', isbn: '978-602-291-111-7', authorName: 'Kak Bimo', publisherName: 'Mizan Pelangi', categoryName: 'Cerita Anak & Dongeng', quantityOrdered: 5, quantityReceived: 5, unitPrice: 60000, status: 'Diterima' },
      { id: 2, title: 'Belajar Membaca Lancar untuk Kelas 1 SD', isbn: '978-602-291-112-4', authorName: 'Tim Literasi SD', publisherName: 'Erlangga for Kids', categoryName: 'Buku Pelajaran & Tematik', quantityOrdered: 5, quantityReceived: 5, unitPrice: 64000, status: 'Diterima' },
    ],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'acquisitions', 'acq_2'), {
    numericId: 2, requestNumber: 'PGD-2026-0002', titleSummary: 'Usulan Buku Eksperimen Sains & Cerita Rakyat Semester Genap',
    supplierId: 'sup_2', supplierName: 'PT Aksara Sekolah Nusantara', requestedByUid: safeUid, requestedByName: safeName,
    approvedByUid: '', approvedByName: '', orderDate: '', receivedDate: '',
    totalEstimatedCost: 740000, status: 'Menunggu Persetujuan', notes: 'Usulan guru kelas 4–6 untuk pojok sains sekolah',
    items: [
      { id: 3, title: 'Seri Pahlawan Kemerdekaan untuk Siswa SD', isbn: '978-602-412-220-5', authorName: 'Watiek Ideo', publisherName: 'Bhuana Ilmu Populer', categoryName: 'Sejarah & Budaya Indonesia', quantityOrdered: 5, quantityReceived: 0, unitPrice: 76000, status: 'Menunggu' },
      { id: 4, title: 'Ensiklopedia Mini Dinosaurus & Fosil', isbn: '978-979-461-221-3', authorName: 'Tim Ensiklopedia Cilik', publisherName: 'Erlangga for Kids', categoryName: 'Sains & Eksperimen Anak', quantityOrdered: 4, quantityReceived: 0, unitPrice: 90000, status: 'Menunggu' },
    ],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  // 12. Inventory Audit
  batch.set(doc(db, 'inventory_audits', 'audit_1'), {
    numericId: 1, auditNumber: 'OPN-2026-0001', title: 'Stock Opname Pojok Baca & Rak Sains SD',
    shelfId: 'shelf_3', shelfCode: 'R-SAI-01', conductedByUid: safeUid, conductedByName: safeName,
    startedAt: '2026-11-12 08:00:00', completedAt: '2026-11-12 10:00:00', status: 'Selesai',
    totalExpected: 5, totalScanned: 5, totalDiscrepancy: 0,
    notes: 'Seluruh buku sains dan eksperimen cilik sesuai catatan sistem',
    items: [
      { id: 1, copyId: 'copy_21', inventoryCode: 'LP-2026-0021', bookTitle: '15 Eksperimen Sains Seru dari Dapur Rumah', expectedStatus: 'Dipinjam', physicalStatus: 'Ditemukan' },
      { id: 2, copyId: 'copy_22', inventoryCode: 'LP-2026-0022', bookTitle: '15 Eksperimen Sains Seru dari Dapur Rumah', expectedStatus: 'Tersedia', physicalStatus: 'Ditemukan' },
    ],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  // 13. Notifications
  const notifs = [
    { id: 'notif_1', numericId: 1, targetRole: 'all_staff', type: 'warning', title: 'Keterlambatan Pengembalian Siswa', message: 'Pinjaman PJM-2026-0006 (Fajar Nugroho, Kelas 6A) melewati jatuh tempo sejak 2026-11-10.', link: '/returns', isRead: false },
    { id: 'notif_2', numericId: 2, targetRole: 'kepala_perpustakaan', type: 'info', title: 'Pengadaan Buku Menunggu Persetujuan', message: 'Pengajuan PGD-2026-0002 senilai Rp 740.000 membutuhkan persetujuan Kepala Perpustakaan.', link: '/acquisitions', isRead: false },
    { id: 'notif_3', numericId: 3, targetRole: 'all_staff', type: 'info', title: 'Antrean Reservasi Aktif', message: '2 permintaan reservasi buku menunggu ketersediaan eksemplar di pojok baca.', link: '/reservations', isRead: false },
    { id: 'notif_4', numericId: 4, targetRole: 'all_staff', type: 'info', title: 'Masa Keanggotaan Akan Berakhir', message: 'Keanggotaan Dewi Anggraini (AGT-2026-0006) berakhir pada 2026-11-25.', link: '/members', isRead: true },
  ];
  for (const n of notifs) {
    const { id, ...rest } = n;
    batch.set(doc(db, 'notifications', id), {
      ...rest,
      targetUid: '',
      memberId: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 14. Class Reading Schedules (All 12 SD Classes)
  for (const s of SEED_READING_SCHEDULES) {
    const { id, ...rest } = s;
    batch.set(doc(db, 'reading_schedules', id), {
      ...rest,
      scheduleDate: '',
      archived: false,
      createdByUid: safeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 14b. School Classes (Wali Kelas, Guru Pendamping & 10 Siswa per Kelas)
  for (const sc of SEED_SCHOOL_CLASSES) {
    const { id, ...rest } = sc;
    batch.set(doc(db, 'school_classes', id), {
      ...rest,
      updatedByUid: safeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 15. Initial Audit Logs
  batch.set(doc(db, 'audit_logs', 'log_1'), {
    userUid: safeUid, userName: safeName, action: 'SYSTEM_INIT', entityType: 'library_settings',
    entityId: 'global', summary: 'Inisialisasi Firestore Free Plan Perpustakaan SD Lentera Pustaka', createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'batch_seed');
  }
}
