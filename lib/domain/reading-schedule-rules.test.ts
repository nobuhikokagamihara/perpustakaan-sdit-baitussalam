import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SD_CLASSES,
  buildAutoClassScheduleSlots,
  buildSeedStudentsForClass,
  computeClassAttendanceComparison,
  computeClassAttendanceRecap,
  computeClassCoverage,
  computeScheduleSummary,
  detectScheduleConflict,
  parseTimeToMinutes,
  summarizeSessionAttendance,
  validateAttendanceEntries,
  validateCompletionLog,
  validateSchedulePayload,
  validateStudentPayload,
  validateTimeRange,
  type AttendanceRecordItem,
  type ClassStudentRecord,
  type ReadingScheduleRecord,
} from './reading-schedule-rules';

test('parseTimeToMinutes and validateTimeRange handle valid and invalid ranges', () => {
  assert.equal(parseTimeToMinutes('07:30'), 450);
  assert.equal(parseTimeToMinutes('25:00'), null);
  assert.equal(parseTimeToMinutes('abc'), null);

  assert.equal(validateTimeRange('07:30', '08:15').ok, true);
  assert.equal(validateTimeRange('07:30', '08:15').durationMinutes, 45);
  assert.equal(validateTimeRange('08:15', '07:30').ok, false);
  assert.equal(validateTimeRange('08:00', '08:10').ok, false); // < 15 min
  assert.equal(validateTimeRange('05:30', '06:30').ok, false); // before 06:30
  assert.equal(validateTimeRange('08:00', '12:00').ok, false); // > 180 min
});

test('detectScheduleConflict flags room overlap and class overlap while allowing non-overlapping or cancelled slots', () => {
  const existing: ReadingScheduleRecord[] = [
    {
      id: 1,
      className: 'Kelas 1A',
      gradeLevel: 1,
      homeroomTeacher: 'Ibu Sari',
      studentCount: 26,
      dayOfWeek: 'Senin',
      startTime: '07:30',
      endTime: '08:15',
      roomArea: 'Pojok Baca Karpet',
      readingMode: 'Membaca Bersama',
      status: 'Terjadwal',
    },
    {
      id: 2,
      className: 'Kelas 2A',
      gradeLevel: 2,
      homeroomTeacher: 'Ibu Dewi',
      studentCount: 27,
      dayOfWeek: 'Senin',
      startTime: '08:15',
      endTime: '09:00',
      roomArea: 'Pojok Baca Karpet',
      readingMode: 'Literasi Pagi',
      status: 'Dibatalkan',
    },
  ];

  // Room overlap on Senin 08:00-08:45 in Pojok Baca Karpet
  const roomConflict = detectScheduleConflict(
    {
      className: 'Kelas 1B',
      dayOfWeek: 'Senin',
      startTime: '08:00',
      endTime: '08:45',
      roomArea: 'Pojok Baca Karpet',
    },
    existing
  );
  assert.equal(roomConflict.hasConflict, true);
  assert.match(roomConflict.reason || '', /Bentrok ruang baca/);

  // Same class overlap in different room
  const classConflict = detectScheduleConflict(
    {
      className: 'Kelas 1A',
      dayOfWeek: 'Senin',
      startTime: '07:45',
      endTime: '08:30',
      roomArea: 'Sudut Sains & Budaya',
    },
    existing
  );
  assert.equal(classConflict.hasConflict, true);
  assert.match(classConflict.reason || '', /Bentrok jadwal kelas/);

  // Editing the same record id does not conflict with itself
  const selfEdit = detectScheduleConflict(
    {
      id: 1,
      className: 'Kelas 1A',
      dayOfWeek: 'Senin',
      startTime: '07:30',
      endTime: '08:15',
      roomArea: 'Pojok Baca Karpet',
    },
    existing
  );
  assert.equal(selfEdit.hasConflict, false);

  // Back-to-back or cancelled slot has no conflict
  const backToBack = detectScheduleConflict(
    {
      className: 'Kelas 3A',
      dayOfWeek: 'Senin',
      startTime: '08:15',
      endTime: '09:00',
      roomArea: 'Pojok Baca Karpet',
    },
    existing
  );
  assert.equal(backToBack.hasConflict, false);
});

test('computeClassCoverage and buildAutoClassScheduleSlots cover all 12 SD classes without conflicts', () => {
  const partial: ReadingScheduleRecord[] = [
    {
      id: 1,
      className: 'Kelas 1A',
      gradeLevel: 1,
      homeroomTeacher: 'Ibu Sari',
      studentCount: 26,
      dayOfWeek: 'Senin',
      startTime: '07:15',
      endTime: '07:50',
      roomArea: 'Pojok Baca Karpet',
      readingMode: 'Membaca Bersama',
      status: 'Selesai',
      studentsPresent: 25,
      booksReadCount: 26,
    },
    {
      id: 2,
      className: 'Kelas 4A',
      gradeLevel: 4,
      homeroomTeacher: 'Ibu Nadia',
      studentCount: 28,
      dayOfWeek: 'Selasa',
      startTime: '08:00',
      endTime: '08:40',
      roomArea: 'Sudut Sains & Budaya',
      readingMode: 'Literasi Pagi',
      status: 'Terjadwal',
    },
  ];

  const cov = computeClassCoverage(partial);
  assert.equal(cov.totalClasses, 12);
  assert.equal(cov.coveredCount, 2);
  assert.equal(cov.missingClasses.length, 10);

  const generated = buildAutoClassScheduleSlots(partial, { id: 1, title: 'Petualangan Kancil' });
  assert.equal(generated.length, 10);

  const combined: ReadingScheduleRecord[] = [
    ...partial,
    ...generated.map((g, idx) => ({ id: 100 + idx, ...g, status: 'Terjadwal' })),
  ];
  const fullCov = computeClassCoverage(combined);
  assert.equal(fullCov.coveredCount, 12);
  assert.equal(fullCov.coveragePercent, 100);
  assert.equal(fullCov.missingClasses.length, 0);

  // Verify zero pairwise conflicts across all 12 classes
  for (const item of combined) {
    const check = detectScheduleConflict(item, combined);
    assert.equal(check.hasConflict, false, `Unexpected conflict for ${item.className}`);
  }

  const summary = computeScheduleSummary(combined);
  assert.equal(summary.totalSessions, SD_CLASSES.length);
  assert.equal(summary.completedSessions, 1);
  assert.equal(summary.totalStudentsPresent, 25);
  assert.equal(summary.totalBooksRead, 26);
});

test('validateSchedulePayload and validateCompletionLog guard inputs', () => {
  assert.equal(
    validateSchedulePayload({
      className: 'Kelas 5A',
      homeroomTeacher: 'Ibu Ratna',
      studentCount: 29,
      dayOfWeek: 'Jumat',
      startTime: '07:15',
      endTime: '07:55',
      roomArea: 'Pojok Baca Karpet',
      readingMode: 'Literasi Pagi',
    }).ok,
    true
  );
  assert.equal(
    validateSchedulePayload({
      className: 'Kelas 5A',
      homeroomTeacher: 'Ibu Ratna',
      studentCount: 29,
      dayOfWeek: 'Minggu',
      startTime: '07:15',
      endTime: '07:55',
      roomArea: 'Pojok Baca Karpet',
      readingMode: 'Literasi Pagi',
    }).ok,
    false
  );

  assert.equal(
    validateCompletionLog({
      status: 'Selesai',
      studentsPresent: 28,
      studentCount: 29,
      booksReadCount: 32,
    }).ok,
    true
  );
  assert.equal(
    validateCompletionLog({
      status: 'Selesai',
      studentsPresent: 32,
      studentCount: 29,
      booksReadCount: 30,
    }).ok,
    false
  );
});

test('all 12 SD classes have wali kelas, guru pendamping, and 10 seeded students each', () => {
  assert.equal(SD_CLASSES.length, 12);
  for (const cls of SD_CLASSES) {
    assert.ok(cls.homeroomTeacher.length > 3, `Missing wali kelas for ${cls.className}`);
    assert.ok(cls.companionTeacher.length > 3, `Missing pendamping for ${cls.className}`);
    const students = buildSeedStudentsForClass(cls.className);
    assert.equal(students.length, 10, `Expected 10 seeded students for ${cls.className}`);
    const codes = new Set(students.map((s) => s.studentCode));
    assert.equal(codes.size, 10, `Duplicate student codes in ${cls.className}`);
  }
});

test('validateStudentPayload and validateAttendanceEntries enforce valid fields', () => {
  assert.equal(
    validateStudentPayload({ className: 'Kelas 3A', fullName: 'Raka Pratama', gender: 'L' }).ok,
    true
  );
  assert.equal(
    validateStudentPayload({ className: 'Kelas 9Z', fullName: 'Raka Pratama', gender: 'L' }).ok,
    false
  );
  assert.equal(
    validateStudentPayload({ className: 'Kelas 3A', fullName: 'A', gender: 'L' }).ok,
    false
  );
  assert.equal(
    validateAttendanceEntries([
      { studentId: 1, status: 'Hadir', booksRead: 2 },
      { studentId: 2, status: 'Sakit', booksRead: 0 },
    ]).ok,
    true
  );
  assert.equal(
    validateAttendanceEntries([
      { studentId: 1, status: 'Hadir', booksRead: 1 },
      { studentId: 1, status: 'Izin', booksRead: 0 },
    ]).ok,
    false
  );
  assert.equal(
    validateAttendanceEntries([{ studentId: 1, status: 'Bolos', booksRead: 0 }]).ok,
    false
  );
});

test('summarizeSessionAttendance and computeClassAttendanceRecap compute present/absent breakdown accurately', () => {
  const students: ClassStudentRecord[] = [
    { id: 1, className: 'Kelas 1A', studentCode: 'NIS-1A-01', fullName: 'Aditya', gender: 'L', status: 'Aktif' },
    { id: 2, className: 'Kelas 1A', studentCode: 'NIS-1A-02', fullName: 'Aisyah', gender: 'P', status: 'Aktif' },
    { id: 3, className: 'Kelas 1A', studentCode: 'NIS-1A-03', fullName: 'Bintang', gender: 'L', status: 'Aktif' },
    { id: 4, className: 'Kelas 1A', studentCode: 'NIS-1A-04', fullName: 'Cinta', gender: 'P', status: 'Aktif' },
  ];

  const session1: AttendanceRecordItem[] = [
    { studentId: 1, studentCode: 'NIS-1A-01', studentName: 'Aditya', status: 'Hadir', booksRead: 2 },
    { studentId: 2, studentCode: 'NIS-1A-02', studentName: 'Aisyah', status: 'Sakit', booksRead: 0, note: 'Demam' },
    { studentId: 3, studentCode: 'NIS-1A-03', studentName: 'Bintang', status: 'Izin', booksRead: 0, note: 'Keluarga' },
    { studentId: 4, studentCode: 'NIS-1A-04', studentName: 'Cinta', status: 'Alpa', booksRead: 0 },
  ];

  const summary = summarizeSessionAttendance(session1);
  assert.equal(summary.totalStudents, 4);
  assert.equal(summary.presentCount, 1);
  assert.equal(summary.absentCount, 3);
  assert.equal(summary.sakitCount, 1);
  assert.equal(summary.izinCount, 1);
  assert.equal(summary.alpaCount, 1);
  assert.equal(summary.attendanceRate, 25);
  assert.equal(summary.totalBooksRead, 2);
  assert.equal(summary.presentStudents[0].studentName, 'Aditya');
  assert.deepEqual(
    summary.absentStudents.map((s) => s.studentName),
    ['Aisyah', 'Bintang', 'Cinta']
  );

  const session2: AttendanceRecordItem[] = [
    { studentId: 1, studentCode: 'NIS-1A-01', studentName: 'Aditya', status: 'Hadir', booksRead: 1 },
    { studentId: 2, studentCode: 'NIS-1A-02', studentName: 'Aisyah', status: 'Hadir', booksRead: 2 },
    { studentId: 3, studentCode: 'NIS-1A-03', studentName: 'Bintang', status: 'Hadir', booksRead: 1 },
    { studentId: 4, studentCode: 'NIS-1A-04', studentName: 'Cinta', status: 'Hadir', booksRead: 1 },
  ];

  const recap = computeClassAttendanceRecap(students, [session1, session2]);
  assert.equal(recap.length, 4);
  assert.equal(recap[0].presentSessions, 2);
  assert.equal(recap[0].attendanceRate, 100);
  assert.equal(recap[0].totalBooksRead, 3);
  assert.equal(recap[1].sakitSessions, 1);
  assert.equal(recap[1].presentSessions, 1);
  assert.equal(recap[1].attendanceRate, 50);
  assert.equal(recap[2].izinSessions, 1);
  assert.equal(recap[3].alpaSessions, 1);
});

test('computeClassAttendanceComparison aggregates present vs absent totals per class across sessions', () => {
  const session1A: AttendanceRecordItem[] = [
    { studentId: 1, studentCode: 'NIS-1A-01', studentName: 'Aditya', status: 'Hadir', booksRead: 2 },
    { studentId: 2, studentCode: 'NIS-1A-02', studentName: 'Aisyah', status: 'Hadir', booksRead: 1 },
    { studentId: 3, studentCode: 'NIS-1A-03', studentName: 'Bintang', status: 'Sakit', booksRead: 0 },
  ];
  const session1A_second: AttendanceRecordItem[] = [
    { studentId: 1, studentCode: 'NIS-1A-01', studentName: 'Aditya', status: 'Hadir', booksRead: 1 },
    { studentId: 2, studentCode: 'NIS-1A-02', studentName: 'Aisyah', status: 'Izin', booksRead: 0 },
    { studentId: 3, studentCode: 'NIS-1A-03', studentName: 'Bintang', status: 'Alpa', booksRead: 0 },
  ];

  const comparison = computeClassAttendanceComparison([
    {
      class_name: 'Kelas 1A',
      attendance: session1A,
      attendance_summary: summarizeSessionAttendance(session1A),
    },
    {
      class_name: 'Kelas 1A',
      attendance: session1A_second,
    },
    // Aggregate-only fallback log (without per-student rows)
    {
      class_name: 'Kelas 2A',
      students_present: 8,
      student_count: 10,
      books_read_count: 12,
    },
  ]);

  assert.equal(comparison.classes.length, 12);
  assert.equal(comparison.totalSessions, 3);
  assert.equal(comparison.classesWithSessions, 2);
  assert.equal(comparison.totalPresent, 11); // (2 + 1) + 8
  assert.equal(comparison.totalAbsent, 5); // (1 + 2) + 2
  assert.equal(comparison.totalSakit, 1);
  assert.equal(comparison.totalIzin, 1);
  assert.equal(comparison.totalAlpa, 1);
  assert.equal(comparison.overallAttendanceRate, Math.round((11 / 16) * 100));

  const kelas1A = comparison.classes.find((c) => c.className === 'Kelas 1A')!;
  assert.equal(kelas1A.shortLabel, '1A');
  assert.equal(kelas1A.sessionsCount, 2);
  assert.equal(kelas1A.presentCount, 3);
  assert.equal(kelas1A.absentCount, 3);
  assert.equal(kelas1A.attendanceRate, 50);
  assert.equal(kelas1A.totalBooksRead, 4);
  assert.equal(kelas1A.hasRecordedSession, true);

  const kelas2A = comparison.classes.find((c) => c.className === 'Kelas 2A')!;
  assert.equal(kelas2A.presentCount, 8);
  assert.equal(kelas2A.absentCount, 2);
  assert.equal(kelas2A.attendanceRate, 80);

  const kelas3A = comparison.classes.find((c) => c.className === 'Kelas 3A')!;
  assert.equal(kelas3A.sessionsCount, 0);
  assert.equal(kelas3A.presentCount, 0);
  assert.equal(kelas3A.absentCount, 0);
  assert.equal(kelas3A.hasRecordedSession, false);

  const emptyComparison = computeClassAttendanceComparison([]);
  assert.equal(emptyComparison.totalPresent, 0);
  assert.equal(emptyComparison.totalAbsent, 0);
  assert.equal(emptyComparison.overallAttendanceRate, 0);
  assert.equal(emptyComparison.classesWithSessions, 0);
});


