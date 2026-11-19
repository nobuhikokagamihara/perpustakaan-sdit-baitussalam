export const READING_DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;
export type ReadingDay = (typeof READING_DAYS)[number];

export const READING_MODES = [
  'Literasi Pagi',
  'Membaca Bersama',
  'Membaca Mandiri',
  'Diskusi & Resensi',
  'Kunjungan Tematik',
] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export const READING_AREAS = [
  'Pojok Baca Karpet',
  'Sudut Sains & Budaya',
  'Meja Referensi & Kamus',
  'Teras Baca Taman',
] as const;
export type ReadingArea = (typeof READING_AREAS)[number];

export const SCHEDULE_STATUSES = [
  'Terjadwal',
  'Berlangsung',
  'Selesai',
  'Ditunda',
  'Dibatalkan',
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['Hadir', 'Izin', 'Sakit', 'Alpa'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface SdClassPreset {
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  studentCount: number;
}

export const SD_CLASSES: readonly SdClassPreset[] = [
  {
    className: 'Kelas 1A',
    gradeLevel: 1,
    homeroomTeacher: 'Ibu Sari Rahayu, S.Pd.',
    companionTeacher: 'Ibu Laila Nurul, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 1B',
    gradeLevel: 1,
    homeroomTeacher: 'Ibu Rina Kartika, S.Pd.',
    companionTeacher: 'Pak Ardiansyah, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 2A',
    gradeLevel: 2,
    homeroomTeacher: 'Ibu Dewi Lestari, S.Pd.',
    companionTeacher: 'Ibu Nisa Amalia, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 2B',
    gradeLevel: 2,
    homeroomTeacher: 'Ibu Maya Puspita, S.Pd.',
    companionTeacher: 'Pak Rizky Maulana, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 3A',
    gradeLevel: 3,
    homeroomTeacher: 'Pak Budi Santoso, S.Pd.',
    companionTeacher: 'Ibu Tania Pratiwi, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 3B',
    gradeLevel: 3,
    homeroomTeacher: 'Ibu Fitriani Putri, S.Pd.',
    companionTeacher: 'Pak Galih Permana, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 4A',
    gradeLevel: 4,
    homeroomTeacher: 'Ibu Nadia Kusuma, S.Pd.',
    companionTeacher: 'Pak Fikri Hakim, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 4B',
    gradeLevel: 4,
    homeroomTeacher: 'Pak Eko Prasetyo, S.Pd.',
    companionTeacher: 'Ibu Wulan Anggraeni, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 5A',
    gradeLevel: 5,
    homeroomTeacher: 'Ibu Ratna Sari, S.Pd.',
    companionTeacher: 'Pak Bagas Saputra, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 5B',
    gradeLevel: 5,
    homeroomTeacher: 'Pak Hendra Gunawan, S.Pd.',
    companionTeacher: 'Ibu Citra Melati, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 6A',
    gradeLevel: 6,
    homeroomTeacher: 'Pak Agus Wijaya, S.Pd.',
    companionTeacher: 'Ibu Dian Permatasari, S.Pd.',
    studentCount: 10,
  },
  {
    className: 'Kelas 6B',
    gradeLevel: 6,
    homeroomTeacher: 'Ibu Yuniarti, S.Pd.',
    companionTeacher: 'Pak Dimas Prasetyo, S.I.Pust.',
    studentCount: 10,
  },
] as const;

export interface ReadingScheduleRecord {
  id: number | string;
  scheduleCode?: string;
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher?: string;
  studentCount: number;
  dayOfWeek: ReadingDay | string;
  scheduleDate?: string | null;
  startTime: string;
  endTime: string;
  roomArea: string;
  readingMode: string;
  readingTheme?: string;
  bookId?: number | string | null;
  bookTitle?: string;
  status: ScheduleStatus | string;
  studentsPresent?: number;
  booksReadCount?: number;
  sessionNotes?: string;
  archived?: boolean;
}

export interface ClassStudentRecord {
  id: number | string;
  className: string;
  studentCode: string;
  fullName: string;
  gender: 'L' | 'P';
  status: 'Aktif' | 'Nonaktif';
  notes?: string;
  archived?: boolean;
}

export interface AttendanceRecordItem {
  studentId: number | string;
  studentCode: string;
  studentName: string;
  status: AttendanceStatus;
  booksRead: number;
  note?: string;
}

export interface SessionAttendanceSummary {
  totalStudents: number;
  presentCount: number;
  absentCount: number;
  izinCount: number;
  sakitCount: number;
  alpaCount: number;
  attendanceRate: number;
  totalBooksRead: number;
  presentStudents: AttendanceRecordItem[];
  absentStudents: AttendanceRecordItem[];
}

export interface StudentCumulativeRecap {
  studentId: number | string;
  studentCode: string;
  fullName: string;
  gender: 'L' | 'P';
  totalSessions: number;
  presentSessions: number;
  izinSessions: number;
  sakitSessions: number;
  alpaSessions: number;
  attendanceRate: number;
  totalBooksRead: number;
}

export interface ScheduleConflictResult {
  hasConflict: boolean;
  reason?: string;
  conflictingSchedule?: ReadingScheduleRecord;
}

export function parseTimeToMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

export function validateTimeRange(
  startTime: string,
  endTime: string
): { ok: boolean; durationMinutes?: number; reason?: string } {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null) {
    return { ok: false, reason: 'Format waktu harus HH:MM (misal 07:30).' };
  }
  if (start < 6 * 60 + 30 || end > 17 * 60) {
    return { ok: false, reason: 'Jam sesi baca SD harus berada dalam rentang 06:30–17:00 WIB.' };
  }
  if (end <= start) {
    return { ok: false, reason: 'Jam selesai harus lebih besar dari jam mulai.' };
  }
  const durationMinutes = end - start;
  if (durationMinutes < 15) {
    return { ok: false, reason: 'Durasi sesi baca minimal 15 menit.' };
  }
  if (durationMinutes > 180) {
    return { ok: false, reason: 'Durasi sesi baca maksimal 180 menit per sesi.' };
  }
  return { ok: true, durationMinutes };
}

export function extractGradeLevel(className: string): number {
  const m = /(\d)/.exec(String(className || ''));
  if (!m) return 1;
  const n = Number(m[1]);
  return n >= 1 && n <= 6 ? n : 1;
}

export function detectScheduleConflict(
  candidate: {
    id?: number | string;
    className: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    roomArea: string;
  },
  existingSchedules: ReadingScheduleRecord[]
): ScheduleConflictResult {
  const cStart = parseTimeToMinutes(candidate.startTime);
  const cEnd = parseTimeToMinutes(candidate.endTime);
  if (cStart === null || cEnd === null || cEnd <= cStart) {
    return { hasConflict: false };
  }

  const candClass = candidate.className.trim().toLowerCase();
  const candRoom = candidate.roomArea.trim().toLowerCase();
  const candDay = candidate.dayOfWeek.trim().toLowerCase();

  for (const item of existingSchedules) {
    if (item.archived) continue;
    if (item.status === 'Dibatalkan') continue;
    if (candidate.id !== undefined && String(item.id) === String(candidate.id)) continue;
    if (String(item.dayOfWeek).trim().toLowerCase() !== candDay) continue;

    const eStart = parseTimeToMinutes(item.startTime);
    const eEnd = parseTimeToMinutes(item.endTime);
    if (eStart === null || eEnd === null) continue;

    const overlaps = cStart < eEnd && eStart < cEnd;
    if (!overlaps) continue;

    if (String(item.roomArea).trim().toLowerCase() === candRoom) {
      return {
        hasConflict: true,
        reason: `Bentrok ruang baca: ${item.roomArea} sudah digunakan oleh ${item.className} pada ${item.dayOfWeek} (${item.startTime}–${item.endTime}).`,
        conflictingSchedule: item,
      };
    }

    if (String(item.className).trim().toLowerCase() === candClass) {
      return {
        hasConflict: true,
        reason: `Bentrok jadwal kelas: ${item.className} sudah memiliki sesi baca pada ${item.dayOfWeek} (${item.startTime}–${item.endTime}) di ${item.roomArea}.`,
        conflictingSchedule: item,
      };
    }
  }

  return { hasConflict: false };
}

export function validateSchedulePayload(input: {
  className: string;
  homeroomTeacher: string;
  companionTeacher?: string;
  studentCount: number;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  roomArea: string;
  readingMode: string;
}): { ok: boolean; reason?: string } {
  const className = String(input.className || '').trim();
  if (!className) {
    return { ok: false, reason: 'Nama kelas SD wajib dipilih.' };
  }
  if (!String(input.homeroomTeacher || '').trim()) {
    return { ok: false, reason: 'Nama wali kelas wajib diisi.' };
  }
  if (input.companionTeacher !== undefined && !String(input.companionTeacher).trim()) {
    return { ok: false, reason: 'Nama guru pendamping wajib diisi.' };
  }
  if (!READING_DAYS.includes(input.dayOfWeek as ReadingDay)) {
    return { ok: false, reason: 'Hari jadwal harus Senin hingga Sabtu.' };
  }
  const timeCheck = validateTimeRange(input.startTime, input.endTime);
  if (!timeCheck.ok) {
    return { ok: false, reason: timeCheck.reason };
  }
  if (!String(input.roomArea || '').trim()) {
    return { ok: false, reason: 'Area / pojok baca wajib dipilih.' };
  }
  if (!String(input.readingMode || '').trim()) {
    return { ok: false, reason: 'Metode kegiatan membaca wajib dipilih.' };
  }
  const students = Number(input.studentCount);
  if (!Number.isFinite(students) || students < 1 || students > 60) {
    return { ok: false, reason: 'Jumlah siswa per kelas harus antara 1 hingga 60 siswa.' };
  }
  return { ok: true };
}

export function validateCompletionLog(input: {
  status: string;
  studentsPresent: number;
  studentCount: number;
  booksReadCount: number;
}): { ok: boolean; reason?: string } {
  if (!SCHEDULE_STATUSES.includes(input.status as ScheduleStatus)) {
    return { ok: false, reason: 'Status sesi jadwal tidak valid.' };
  }
  const present = Number(input.studentsPresent);
  const enrolled = Number(input.studentCount);
  const booksRead = Number(input.booksReadCount);
  if (!Number.isFinite(present) || present < 0) {
    return { ok: false, reason: 'Jumlah siswa hadir tidak boleh negatif.' };
  }
  if (enrolled > 0 && present > enrolled) {
    return {
      ok: false,
      reason: `Jumlah siswa hadir (${present}) tidak boleh melebihi jumlah siswa terdaftar (${enrolled}).`,
    };
  }
  if (!Number.isFinite(booksRead) || booksRead < 0 || booksRead > 500) {
    return { ok: false, reason: 'Jumlah buku dibaca harus antara 0 hingga 500.' };
  }
  return { ok: true };
}

export interface ClassCoverageEntry {
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  defaultStudentCount: number;
  sessionCount: number;
  completedCount: number;
  totalMinutes: number;
  hasSchedule: boolean;
}

export interface ClassCoverageSummary {
  totalClasses: number;
  coveredCount: number;
  missingClasses: string[];
  coveragePercent: number;
  classBreakdown: ClassCoverageEntry[];
}

export function computeClassCoverage(schedules: ReadingScheduleRecord[]): ClassCoverageSummary {
  const active = schedules.filter((s) => !s.archived && s.status !== 'Dibatalkan');

  const classBreakdown: ClassCoverageEntry[] = SD_CLASSES.map((preset) => {
    const classItems = active.filter(
      (s) => s.className.trim().toLowerCase() === preset.className.toLowerCase()
    );
    let totalMinutes = 0;
    let completedCount = 0;
    for (const item of classItems) {
      const s = parseTimeToMinutes(item.startTime);
      const e = parseTimeToMinutes(item.endTime);
      if (s !== null && e !== null && e > s) {
        totalMinutes += e - s;
      }
      if (item.status === 'Selesai') {
        completedCount += 1;
      }
    }
    return {
      className: preset.className,
      gradeLevel: preset.gradeLevel,
      homeroomTeacher: classItems[0]?.homeroomTeacher || preset.homeroomTeacher,
      companionTeacher: classItems[0]?.companionTeacher || preset.companionTeacher,
      defaultStudentCount: preset.studentCount,
      sessionCount: classItems.length,
      completedCount,
      totalMinutes,
      hasSchedule: classItems.length > 0,
    };
  });

  const coveredCount = classBreakdown.filter((c) => c.hasSchedule).length;
  const missingClasses = classBreakdown.filter((c) => !c.hasSchedule).map((c) => c.className);
  const totalClasses = SD_CLASSES.length;
  const coveragePercent = Math.round((coveredCount / totalClasses) * 100);

  return {
    totalClasses,
    coveredCount,
    missingClasses,
    coveragePercent,
    classBreakdown,
  };
}

export interface ScheduleSummary {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  totalScheduledStudents: number;
  totalStudentsPresent: number;
  totalBooksRead: number;
}

export function computeScheduleSummary(schedules: ReadingScheduleRecord[]): ScheduleSummary {
  const nonArchived = schedules.filter((s) => !s.archived);
  const active = nonArchived.filter((s) => s.status !== 'Dibatalkan');
  const completed = active.filter((s) => s.status === 'Selesai');

  return {
    totalSessions: nonArchived.length,
    activeSessions: active.length,
    completedSessions: completed.length,
    totalScheduledStudents: active.reduce((sum, s) => sum + Number(s.studentCount || 0), 0),
    totalStudentsPresent: active.reduce((sum, s) => sum + Number(s.studentsPresent || 0), 0),
    totalBooksRead: active.reduce((sum, s) => sum + Number(s.booksReadCount || 0), 0),
  };
}

const CANDIDATE_SLOTS: ReadonlyArray<[string, string]> = [
  ['07:15', '07:50'],
  ['08:00', '08:40'],
  ['09:00', '09:40'],
  ['10:00', '10:40'],
  ['11:00', '11:40'],
  ['13:00', '13:40'],
];

export interface GeneratedClassSlot {
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  studentCount: number;
  dayOfWeek: ReadingDay;
  startTime: string;
  endTime: string;
  roomArea: string;
  readingMode: ReadingMode;
  readingTheme: string;
  bookId: number | string | null;
  bookTitle: string;
}

export function buildAutoClassScheduleSlots(
  existingSchedules: ReadingScheduleRecord[],
  defaultBook?: { id: number | string; title: string } | null
): GeneratedClassSlot[] {
  const working: ReadingScheduleRecord[] = [...existingSchedules];
  const coverage = computeClassCoverage(working);
  const created: GeneratedClassSlot[] = [];

  for (let i = 0; i < coverage.missingClasses.length; i++) {
    const className = coverage.missingClasses[i];
    const preset = SD_CLASSES.find((c) => c.className === className)!;
    const mode =
      preset.gradeLevel <= 2
        ? 'Membaca Bersama'
        : preset.gradeLevel <= 4
          ? 'Literasi Pagi'
          : 'Diskusi & Resensi';
    const preferredArea =
      preset.gradeLevel <= 2
        ? 'Pojok Baca Karpet'
        : preset.gradeLevel <= 4
          ? 'Sudut Sains & Budaya'
          : 'Meja Referensi & Kamus';

    let picked: GeneratedClassSlot | null = null;
    const areaOrder = [preferredArea, ...READING_AREAS.filter((a) => a !== preferredArea)];

    outer: for (const day of READING_DAYS) {
      for (const [startTime, endTime] of CANDIDATE_SLOTS) {
        for (const roomArea of areaOrder) {
          const conflict = detectScheduleConflict(
            { className, dayOfWeek: day, startTime, endTime, roomArea },
            working
          );
          if (!conflict.hasConflict) {
            picked = {
              className,
              gradeLevel: preset.gradeLevel,
              homeroomTeacher: preset.homeroomTeacher,
              companionTeacher: preset.companionTeacher,
              studentCount: preset.studentCount,
              dayOfWeek: day,
              startTime,
              endTime,
              roomArea,
              readingMode: mode,
              readingTheme: `Sesi Literasi Mingguan ${className}`,
              bookId: defaultBook?.id ?? null,
              bookTitle: defaultBook?.title ?? 'Koleksi Bacaan Pilihan SD',
            };
            break outer;
          }
        }
      }
    }

    if (picked) {
      created.push(picked);
      working.push({
        id: `auto-${i}`,
        ...picked,
        status: 'Terjadwal',
      });
    }
  }

  return created;
}

export function getClassPreset(className: string): SdClassPreset | undefined {
  return SD_CLASSES.find((c) => c.className.toLowerCase() === String(className || '').trim().toLowerCase());
}

export function validateStudentPayload(input: {
  className: string;
  fullName: string;
  studentCode?: string;
  gender: string;
}): { ok: boolean; reason?: string } {
  const cls = String(input.className || '').trim();
  if (!SD_CLASSES.some((c) => c.className === cls)) {
    return { ok: false, reason: 'Kelas SD harus dipilih dari Kelas 1A hingga Kelas 6B.' };
  }
  const name = String(input.fullName || '').trim();
  if (name.length < 2 || name.length > 100) {
    return { ok: false, reason: 'Nama lengkap siswa harus antara 2 hingga 100 karakter.' };
  }
  if (input.gender !== 'L' && input.gender !== 'P') {
    return { ok: false, reason: 'Jenis kelamin siswa harus L (Laki-laki) atau P (Perempuan).' };
  }
  if (input.studentCode !== undefined && String(input.studentCode).trim().length > 32) {
    return { ok: false, reason: 'Nomor induk / kode siswa maksimal 32 karakter.' };
  }
  return { ok: true };
}

export function validateAttendanceEntries(
  entries: Array<{ studentId: number | string; status: string; booksRead?: number }>
): { ok: boolean; reason?: string } {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, reason: 'Daftar absensi siswa tidak boleh kosong.' };
  }
  if (entries.length > 60) {
    return { ok: false, reason: 'Maksimal 60 siswa dalam satu sesi absensi.' };
  }
  const seen = new Set<string>();
  for (const e of entries) {
    const sid = String(e.studentId ?? '').trim();
    if (!sid) {
      return { ok: false, reason: 'Setiap baris absensi wajib memiliki identitas siswa.' };
    }
    if (seen.has(sid)) {
      return { ok: false, reason: 'Terdapat duplikasi siswa dalam daftar absensi.' };
    }
    seen.add(sid);
    if (!ATTENDANCE_STATUSES.includes(e.status as AttendanceStatus)) {
      return { ok: false, reason: `Status kehadiran "${e.status}" tidak valid.` };
    }
    const books = Number(e.booksRead ?? 0);
    if (!Number.isFinite(books) || books < 0 || books > 20) {
      return { ok: false, reason: 'Jumlah buku dibaca per siswa harus antara 0 hingga 20.' };
    }
  }
  return { ok: true };
}

export function summarizeSessionAttendance(entries: AttendanceRecordItem[]): SessionAttendanceSummary {
  const presentStudents: AttendanceRecordItem[] = [];
  const absentStudents: AttendanceRecordItem[] = [];
  let izinCount = 0;
  let sakitCount = 0;
  let alpaCount = 0;
  let totalBooksRead = 0;

  for (const e of entries) {
    if (e.status === 'Hadir') {
      presentStudents.push(e);
      totalBooksRead += Math.max(0, Number(e.booksRead || 0));
    } else {
      absentStudents.push(e);
      if (e.status === 'Izin') izinCount += 1;
      else if (e.status === 'Sakit') sakitCount += 1;
      else alpaCount += 1;
    }
  }

  const totalStudents = entries.length;
  const presentCount = presentStudents.length;
  const absentCount = absentStudents.length;
  const attendanceRate = totalStudents > 0 ? Math.round((presentCount / totalStudents) * 100) : 0;

  return {
    totalStudents,
    presentCount,
    absentCount,
    izinCount,
    sakitCount,
    alpaCount,
    attendanceRate,
    totalBooksRead,
    presentStudents,
    absentStudents,
  };
}

export function computeClassAttendanceRecap(
  students: ClassStudentRecord[],
  sessionAttendanceGroups: AttendanceRecordItem[][]
): StudentCumulativeRecap[] {
  const activeStudents = students.filter((s) => !s.archived);
  return activeStudents.map((st) => {
    let totalSessions = 0;
    let presentSessions = 0;
    let izinSessions = 0;
    let sakitSessions = 0;
    let alpaSessions = 0;
    let totalBooksRead = 0;

    for (const group of sessionAttendanceGroups) {
      const rec = group.find(
        (item) =>
          String(item.studentId) === String(st.id) ||
          (item.studentCode && item.studentCode === st.studentCode)
      );
      if (!rec) continue;
      totalSessions += 1;
      if (rec.status === 'Hadir') {
        presentSessions += 1;
        totalBooksRead += Math.max(0, Number(rec.booksRead || 0));
      } else if (rec.status === 'Izin') {
        izinSessions += 1;
      } else if (rec.status === 'Sakit') {
        sakitSessions += 1;
      } else {
        alpaSessions += 1;
      }
    }

    const attendanceRate = totalSessions > 0 ? Math.round((presentSessions / totalSessions) * 100) : 0;
    return {
      studentId: st.id,
      studentCode: st.studentCode,
      fullName: st.fullName,
      gender: st.gender,
      totalSessions,
      presentSessions,
      izinSessions,
      sakitSessions,
      alpaSessions,
      attendanceRate,
      totalBooksRead,
    };
  });
}

export interface AttendanceComparisonLogInput {
  class_name?: string;
  className?: string;
  students_present?: number;
  studentsPresent?: number;
  student_count?: number;
  studentCount?: number;
  books_read_count?: number;
  booksReadCount?: number;
  attendance?: AttendanceRecordItem[];
  attendance_summary?: SessionAttendanceSummary | null;
}

export interface ClassAttendanceComparisonEntry {
  className: string;
  shortLabel: string;
  gradeLevel: number;
  sessionsCount: number;
  presentCount: number;
  absentCount: number;
  izinCount: number;
  sakitCount: number;
  alpaCount: number;
  totalTracked: number;
  attendanceRate: number;
  totalBooksRead: number;
  hasRecordedSession: boolean;
}

export interface ClassAttendanceComparisonSummary {
  classes: ClassAttendanceComparisonEntry[];
  totalPresent: number;
  totalAbsent: number;
  totalIzin: number;
  totalSakit: number;
  totalAlpa: number;
  totalSessions: number;
  classesWithSessions: number;
  overallAttendanceRate: number;
}

export function computeClassAttendanceComparison(
  logs: AttendanceComparisonLogInput[],
  classPresets: ReadonlyArray<Pick<SdClassPreset, 'className' | 'gradeLevel'>> = SD_CLASSES
): ClassAttendanceComparisonSummary {
  const orderedMap = new Map<string, ClassAttendanceComparisonEntry>();

  const ensureEntry = (rawClassName: string, gradeLevel?: number): ClassAttendanceComparisonEntry => {
    const cleanName = String(rawClassName || '').trim() || 'Kelas Lainnya';
    const key = cleanName.toLowerCase();
    const existing = orderedMap.get(key);
    if (existing) return existing;

    const entry: ClassAttendanceComparisonEntry = {
      className: cleanName,
      shortLabel: cleanName.replace(/^Kelas\s+/i, ''),
      gradeLevel: gradeLevel ?? extractGradeLevel(cleanName),
      sessionsCount: 0,
      presentCount: 0,
      absentCount: 0,
      izinCount: 0,
      sakitCount: 0,
      alpaCount: 0,
      totalTracked: 0,
      attendanceRate: 0,
      totalBooksRead: 0,
      hasRecordedSession: false,
    };
    orderedMap.set(key, entry);
    return entry;
  };

  for (const preset of classPresets) {
    ensureEntry(preset.className, preset.gradeLevel);
  }

  for (const log of logs) {
    const rawName = log.class_name ?? log.className ?? '';
    if (!rawName.trim()) continue;
    const entry = ensureEntry(rawName);

    const summary =
      log.attendance_summary ??
      (Array.isArray(log.attendance) && log.attendance.length > 0
        ? summarizeSessionAttendance(log.attendance)
        : null);

    let present = 0;
    let absent = 0;
    let izin = 0;
    let sakit = 0;
    let alpa = 0;
    let books = 0;

    if (summary) {
      present = Math.max(0, Number(summary.presentCount || 0));
      absent = Math.max(0, Number(summary.absentCount || 0));
      izin = Math.max(0, Number(summary.izinCount || 0));
      sakit = Math.max(0, Number(summary.sakitCount || 0));
      alpa = Math.max(0, Number(summary.alpaCount || 0));
      books = Math.max(0, Number(summary.totalBooksRead || 0));
    } else {
      present = Math.max(0, Number(log.students_present ?? log.studentsPresent ?? 0));
      const enrolled = Math.max(0, Number(log.student_count ?? log.studentCount ?? 0));
      absent = enrolled > present ? enrolled - present : 0;
      books = Math.max(0, Number(log.books_read_count ?? log.booksReadCount ?? 0));
    }

    entry.sessionsCount += 1;
    entry.presentCount += present;
    entry.absentCount += absent;
    entry.izinCount += izin;
    entry.sakitCount += sakit;
    entry.alpaCount += alpa;
    entry.totalBooksRead += books;
    entry.hasRecordedSession = true;
  }

  let totalPresent = 0;
  let totalAbsent = 0;
  let totalIzin = 0;
  let totalSakit = 0;
  let totalAlpa = 0;
  let totalSessions = 0;
  let classesWithSessions = 0;

  const classes = Array.from(orderedMap.values()).map((entry) => {
    const totalTracked = entry.presentCount + entry.absentCount;
    const attendanceRate =
      totalTracked > 0 ? Math.round((entry.presentCount / totalTracked) * 100) : 0;

    totalPresent += entry.presentCount;
    totalAbsent += entry.absentCount;
    totalIzin += entry.izinCount;
    totalSakit += entry.sakitCount;
    totalAlpa += entry.alpaCount;
    totalSessions += entry.sessionsCount;
    if (entry.hasRecordedSession) classesWithSessions += 1;

    return {
      ...entry,
      totalTracked,
      attendanceRate,
    };
  });

  const grandTotal = totalPresent + totalAbsent;
  const overallAttendanceRate =
    grandTotal > 0 ? Math.round((totalPresent / grandTotal) * 100) : 0;

  return {
    classes,
    totalPresent,
    totalAbsent,
    totalIzin,
    totalSakit,
    totalAlpa,
    totalSessions,
    classesWithSessions,
    overallAttendanceRate,
  };
}

const SEED_CLASS_ROSTERS: Record<string, ReadonlyArray<{ name: string; gender: 'L' | 'P' }>> = {
  'Kelas 1A': [
    { name: 'Aditya Pratama', gender: 'L' },
    { name: 'Aisyah Putri Ramadhani', gender: 'P' },
    { name: 'Bintang Mahendra', gender: 'L' },
    { name: 'Cinta Kirana Dewi', gender: 'P' },
    { name: 'Daffa Alfarizi', gender: 'L' },
    { name: 'Fadhila Azzahra', gender: 'P' },
    { name: 'Gilang Ramadhan', gender: 'L' },
    { name: 'Hana Safira', gender: 'P' },
    { name: 'Ilham Saputra', gender: 'L' },
    { name: 'Kayla Salsabila', gender: 'P' },
  ],
  'Kelas 1B': [
    { name: 'Akbar Maulana', gender: 'L' },
    { name: 'Anindya Larasati', gender: 'P' },
    { name: 'Bagus Setiawan', gender: 'L' },
    { name: 'Citra Ayu Lestari', gender: 'P' },
    { name: 'Dimas Nugraha', gender: 'L' },
    { name: 'Eka Putri Maharani', gender: 'P' },
    { name: 'Farel Kurniawan', gender: 'L' },
    { name: 'Gita Cahyani', gender: 'P' },
    { name: 'Hafiz Al-Fatih', gender: 'L' },
    { name: 'Intan Permata Sari', gender: 'P' },
  ],
  'Kelas 2A': [
    { name: 'Alvaro Wijaya', gender: 'L' },
    { name: 'Aulia Rahmawati', gender: 'P' },
    { name: 'Bayu Segara', gender: 'L' },
    { name: 'Calista Oktavia', gender: 'P' },
    { name: 'Danendra Putra', gender: 'L' },
    { name: 'Elsa Nabila Putri', gender: 'P' },
    { name: 'Fauzan Hakim', gender: 'L' },
    { name: 'Ghina Khairunnisa', gender: 'P' },
    { name: 'Haris Firmansyah', gender: 'L' },
    { name: 'Indira Kusuma', gender: 'P' },
  ],
  'Kelas 2B': [
    { name: 'Arjuna Santoso', gender: 'L' },
    { name: 'Bella Puspitasari', gender: 'P' },
    { name: 'Candra Kusuma', gender: 'L' },
    { name: 'Dinda Aulia', gender: 'P' },
    { name: 'Evan Pratama', gender: 'L' },
    { name: 'Farah Amalia', gender: 'P' },
    { name: 'Gavin Putra', gender: 'L' },
    { name: 'Hasna Nafisah', gender: 'P' },
    { name: 'Ibrahim Rasyid', gender: 'L' },
    { name: 'Jihan Melani', gender: 'P' },
  ],
  'Kelas 3A': [
    { name: 'Alya Putri Azzahra', gender: 'P' },
    { name: 'Azka Firdaus', gender: 'L' },
    { name: 'Bunga Melati', gender: 'P' },
    { name: 'Damar Wibowo', gender: 'L' },
    { name: 'Erina Salsabila', gender: 'P' },
    { name: 'Fathan Al-Ghozali', gender: 'L' },
    { name: 'Gendis Ayu', gender: 'P' },
    { name: 'Hilmi Kurnia', gender: 'L' },
    { name: 'Inayah Zahra', gender: 'P' },
    { name: 'Joko Susilo', gender: 'L' },
  ],
  'Kelas 3B': [
    { name: 'Afifah Nuraini', gender: 'P' },
    { name: 'Bastian Hidayat', gender: 'L' },
    { name: 'Clara Wijaya', gender: 'P' },
    { name: 'Dzaky Mubarak', gender: 'L' },
    { name: 'Felisha Ananda', gender: 'P' },
    { name: 'Galang Samudra', gender: 'L' },
    { name: 'Humaira Putri', gender: 'P' },
    { name: 'Iqbal Ramadhan', gender: 'L' },
    { name: 'Keisha Maharani', gender: 'P' },
    { name: 'Lutfi Hakim', gender: 'L' },
  ],
  'Kelas 4A': [
    { name: 'Abimanyu Sakti', gender: 'L' },
    { name: 'Amira Khairani', gender: 'P' },
    { name: 'Cakra Buana', gender: 'L' },
    { name: 'Dewi Anggraini', gender: 'P' },
    { name: 'Erlangga Saputra', gender: 'L' },
    { name: 'Fanya Oktaviani', gender: 'P' },
    { name: 'Gibran Al-Habsyi', gender: 'L' },
    { name: 'Hilda Kartika', gender: 'P' },
    { name: 'Irfan Maulana', gender: 'L' },
    { name: 'Jasmine Nadhira', gender: 'P' },
  ],
  'Kelas 4B': [
    { name: 'Agung Laksono', gender: 'L' },
    { name: 'Azzahra Ramadhani', gender: 'P' },
    { name: 'Bara Pradipta', gender: 'L' },
    { name: 'Celine Putri', gender: 'P' },
    { name: 'Devan Putra', gender: 'L' },
    { name: 'Erika Wulandari', gender: 'P' },
    { name: 'Farhan Syahputra', gender: 'L' },
    { name: 'Gisella Amanda', gender: 'P' },
    { name: 'Hendra Wijaya', gender: 'L' },
    { name: 'Isabella Rahma', gender: 'P' },
  ],
  'Kelas 5A': [
    { name: 'Bima Pratama Putra', gender: 'L' },
    { name: 'Adelia Kusuma', gender: 'P' },
    { name: 'Chandra Pratama', gender: 'L' },
    { name: 'Dhea Safitri', gender: 'P' },
    { name: 'Fadhil Nurrahman', gender: 'L' },
    { name: 'Gracia Nathania', gender: 'P' },
    { name: 'Haikal Firdaus', gender: 'L' },
    { name: 'Indah Permatasari', gender: 'P' },
    { name: 'Kevin Anggara', gender: 'L' },
    { name: 'Larasati Ningrum', gender: 'P' },
  ],
  'Kelas 5B': [
    { name: 'Arief Budiman', gender: 'L' },
    { name: 'Cantika Dewi', gender: 'P' },
    { name: 'Dionisius Bagas', gender: 'L' },
    { name: 'Elvira Puspita', gender: 'P' },
    { name: 'Faisal Akbar', gender: 'L' },
    { name: 'Gita Larasati', gender: 'P' },
    { name: 'Hafizh Kurniawan', gender: 'L' },
    { name: 'Ika Novitasari', gender: 'P' },
    { name: 'Jefri Gunawan', gender: 'L' },
    { name: 'Karina Putri', gender: 'P' },
  ],
  'Kelas 6A': [
    { name: 'Fajar Nugroho', gender: 'L' },
    { name: 'Alisha Rahma', gender: 'P' },
    { name: 'Bramantyo Wibowo', gender: 'L' },
    { name: 'Desi Ratnasari', gender: 'P' },
    { name: 'Edo Kurniawan', gender: 'L' },
    { name: 'Febriana Lestari', gender: 'P' },
    { name: 'Guntur Prakoso', gender: 'L' },
    { name: 'Hesti Wulandari', gender: 'P' },
    { name: 'Ihsanul Fikri', gender: 'L' },
    { name: 'Kartika Sari', gender: 'P' },
  ],
  'Kelas 6B': [
    { name: 'Siti Rahmawati', gender: 'P' },
    { name: 'Ahmad Fauzi', gender: 'L' },
    { name: 'Belinda Cahya', gender: 'P' },
    { name: 'Darmawan Putra', gender: 'L' },
    { name: 'Endah Pratiwi', gender: 'P' },
    { name: 'Firman Hidayat', gender: 'L' },
    { name: 'Galuh Kirana', gender: 'P' },
    { name: 'Haryanto Kusuma', gender: 'L' },
    { name: 'Irma Suryani', gender: 'P' },
    { name: 'Jaya Pratama', gender: 'L' },
  ],
};

export function buildSeedStudentsForClass(
  className: string
): Array<{ studentCode: string; fullName: string; gender: 'L' | 'P' }> {
  const shortCode = className.replace(/^Kelas\s+/i, '').toUpperCase();
  const list = SEED_CLASS_ROSTERS[className] || [];
  return list.map((s, idx) => ({
    studentCode: `NIS-${shortCode}-${String(idx + 1).padStart(2, '0')}`,
    fullName: s.name,
    gender: s.gender,
  }));
}

