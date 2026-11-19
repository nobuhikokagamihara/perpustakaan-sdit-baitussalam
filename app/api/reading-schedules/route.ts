import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  READING_AREAS,
  READING_DAYS,
  SD_CLASSES,
  buildAutoClassScheduleSlots,
  computeClassCoverage,
  computeScheduleSummary,
  detectScheduleConflict,
  extractGradeLevel,
  getClassPreset,
  summarizeSessionAttendance,
  validateSchedulePayload,
  type AttendanceRecordItem,
  type AttendanceStatus,
  type ReadingScheduleRecord,
} from '@/lib/domain/reading-schedule-rules';

interface SqlScheduleRow {
  id: number;
  schedule_code: string;
  class_name: string;
  grade_level: number;
  homeroom_teacher: string;
  companion_teacher: string;
  student_count: number;
  day_of_week: string;
  schedule_date: string | null;
  start_time: string;
  end_time: string;
  room_area: string;
  reading_mode: string;
  reading_theme: string;
  book_id: number | null;
  book_title: string | null;
  status: string;
  students_present: number;
  books_read_count: number;
  session_notes: string;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SqlLogRow {
  id: number;
  schedule_id: number;
  schedule_code: string;
  class_name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room_area: string;
  reading_mode: string;
  homeroom_teacher: string;
  companion_teacher: string;
  student_count: number;
  session_date: string;
  status: string;
  students_present: number;
  books_read_count: number;
  notes: string;
  recorded_by_name: string;
  created_at: string;
}

interface SqlAttRow {
  log_id: number;
  student_id: number;
  student_code: string;
  student_name: string;
  status: AttendanceStatus;
  books_read: number;
  note: string;
}

interface SqlClassInfoRow {
  class_name: string;
  grade_level: number;
  homeroom_teacher: string;
  companion_teacher: string;
  active_student_count: number;
}

function toDomainRecord(r: SqlScheduleRow): ReadingScheduleRecord {
  return {
    id: r.id,
    scheduleCode: r.schedule_code,
    className: r.class_name,
    gradeLevel: r.grade_level,
    homeroomTeacher: r.homeroom_teacher,
    companionTeacher: r.companion_teacher,
    studentCount: r.student_count,
    dayOfWeek: r.day_of_week,
    scheduleDate: r.schedule_date,
    startTime: r.start_time,
    endTime: r.end_time,
    roomArea: r.room_area,
    readingMode: r.reading_mode,
    readingTheme: r.reading_theme,
    bookId: r.book_id,
    bookTitle: r.book_title || '',
    status: r.status,
    studentsPresent: r.students_present,
    booksReadCount: r.books_read_count,
    sessionNotes: r.session_notes,
    archived: Boolean(r.archived_at),
  };
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('schedules.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const day = sp.get('day')?.trim() || '';
  const grade = sp.get('grade')?.trim() || '';
  const className = sp.get('className')?.trim() || '';
  const status = sp.get('status')?.trim() || '';
  const q = sp.get('q')?.trim().toLowerCase() || '';

  const allRows = db
    .prepare(
      `SELECT rs.*, b.title as book_title
       FROM reading_schedules rs
       LEFT JOIN books b ON b.id = rs.book_id
       WHERE rs.archived_at IS NULL
       ORDER BY
         CASE rs.day_of_week
           WHEN 'Senin' THEN 1
           WHEN 'Selasa' THEN 2
           WHEN 'Rabu' THEN 3
           WHEN 'Kamis' THEN 4
           WHEN 'Jumat' THEN 5
           WHEN 'Sabtu' THEN 6
           ELSE 7
         END,
         rs.start_time ASC,
         rs.grade_level ASC,
         rs.class_name ASC`
    )
    .all() as SqlScheduleRow[];

  const domainAll = allRows.map(toDomainRecord);
  const coverage = computeClassCoverage(domainAll);
  const summary = computeScheduleSummary(domainAll);

  const filtered = allRows.filter((row) => {
    if (day && row.day_of_week !== day) return false;
    if (grade && String(row.grade_level) !== grade) return false;
    if (className && row.class_name !== className) return false;
    if (status && row.status !== status) return false;
    if (q) {
      const hay = [
        row.schedule_code,
        row.class_name,
        row.homeroom_teacher,
        row.companion_teacher,
        row.room_area,
        row.reading_mode,
        row.reading_theme,
        row.book_title || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const rawLogs = db
    .prepare(
      `SELECT l.*, rs.schedule_code, rs.class_name, rs.day_of_week, rs.start_time, rs.end_time,
              rs.room_area, rs.reading_mode, rs.homeroom_teacher, rs.companion_teacher, rs.student_count
       FROM reading_schedule_logs l
       JOIN reading_schedules rs ON rs.id = l.schedule_id
       ORDER BY l.session_date DESC, l.id DESC
       LIMIT 60`
    )
    .all() as SqlLogRow[];

  const logIds = rawLogs.map((l) => l.id);
  const attByLog = new Map<number, AttendanceRecordItem[]>();
  if (logIds.length > 0) {
    const placeholders = logIds.map(() => '?').join(',');
    const attRows = db
      .prepare(
        `SELECT log_id, student_id, student_code, student_name, status, books_read, note
         FROM reading_session_attendance
         WHERE log_id IN (${placeholders})
         ORDER BY student_code ASC, student_name ASC`
      )
      .all(...logIds) as SqlAttRow[];
    for (const a of attRows) {
      const arr = attByLog.get(a.log_id) || [];
      arr.push({
        studentId: a.student_id,
        studentCode: a.student_code,
        studentName: a.student_name,
        status: a.status,
        booksRead: a.books_read,
        note: a.note,
      });
      attByLog.set(a.log_id, arr);
    }
  }

  const logs = rawLogs.map((l) => {
    const attendance = attByLog.get(l.id) || [];
    const attendance_summary =
      attendance.length > 0 ? summarizeSessionAttendance(attendance) : null;
    return {
      ...l,
      attendance,
      attendance_summary,
    };
  });

  const liveClasses = db
    .prepare(
      `SELECT sc.class_name, sc.grade_level, sc.homeroom_teacher, sc.companion_teacher,
              (SELECT COUNT(*) FROM class_students cs WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL) as active_student_count
       FROM school_classes sc
       ORDER BY sc.grade_level ASC, sc.class_name ASC`
    )
    .all() as SqlClassInfoRow[];

  const classes =
    liveClasses.length > 0
      ? liveClasses.map((c) => ({
          className: c.class_name,
          gradeLevel: c.grade_level,
          homeroomTeacher: c.homeroom_teacher,
          companionTeacher: c.companion_teacher,
          studentCount: c.active_student_count || 10,
        }))
      : SD_CLASSES;

  const books = db
    .prepare('SELECT id, title FROM books WHERE archived_at IS NULL ORDER BY title ASC')
    .all() as Array<{ id: number; title: string }>;

  return NextResponse.json({
    schedules: filtered,
    logs,
    coverage,
    summary,
    classes,
    days: READING_DAYS,
    areas: READING_AREAS,
    books,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const db = getDb();

    if (body.action === 'generate_missing') {
      const existingRows = db
        .prepare(
          `SELECT rs.*, b.title as book_title
           FROM reading_schedules rs
           LEFT JOIN books b ON b.id = rs.book_id
           WHERE rs.archived_at IS NULL`
        )
        .all() as SqlScheduleRow[];

      const defaultBook = db
        .prepare('SELECT id, title FROM books WHERE archived_at IS NULL ORDER BY id ASC LIMIT 1')
        .get() as { id: number; title: string } | undefined;

      const slotsToCreate = buildAutoClassScheduleSlots(
        existingRows.map(toDomainRecord),
        defaultBook ?? null
      );

      if (slotsToCreate.length === 0) {
        return NextResponse.json({
          createdCount: 0,
          createdCodes: [],
          message: 'Seluruh 12 kelas (Kelas 1A–6B) sudah memiliki jadwal baca aktif.',
        });
      }

      const liveClassRows = db
        .prepare(
          `SELECT sc.class_name, sc.homeroom_teacher, sc.companion_teacher,
                  (SELECT COUNT(*) FROM class_students cs WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL) as active_student_count
           FROM school_classes sc`
        )
        .all() as Array<{
        class_name: string;
        homeroom_teacher: string;
        companion_teacher: string;
        active_student_count: number;
      }>;
      const liveClassMap = new Map(liveClassRows.map((c) => [c.class_name, c]));

      const createdCodes = db.transaction(() => {
        const maxIdRow = db
          .prepare('SELECT COALESCE(MAX(id), 0) as m FROM reading_schedules')
          .get() as { m: number };
        let nextSeq = maxIdRow.m + 1;

        const ins = db.prepare(`
          INSERT INTO reading_schedules (
            schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count,
            day_of_week, start_time, end_time, room_area, reading_mode, reading_theme,
            book_id, status, created_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Terjadwal', ?)
        `);

        const codes: string[] = [];
        for (const slot of slotsToCreate) {
          const code = `JDW-2026-${String(nextSeq++).padStart(4, '0')}`;
          const live = liveClassMap.get(slot.className);
          ins.run(
            code,
            slot.className,
            slot.gradeLevel,
            live?.homeroom_teacher || slot.homeroomTeacher,
            live?.companion_teacher || slot.companionTeacher,
            live?.active_student_count || slot.studentCount,
            slot.dayOfWeek,
            slot.startTime,
            slot.endTime,
            slot.roomArea,
            slot.readingMode,
            slot.readingTheme,
            slot.bookId,
            guard.user.id
          );
          codes.push(code);
        }

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'SCHEDULE_AUTO_GENERATE',
          entityType: 'reading_schedules',
          entityId: codes.join(','),
          after: { createdCount: codes.length, codes },
        });

        return codes;
      })();

      return NextResponse.json(
        {
          createdCount: createdCodes.length,
          createdCodes,
          message: `Berhasil melengkapi ${createdCodes.length} jadwal kelas yang belum terjadwal.`,
        },
        { status: 201 }
      );
    }

    const className = String(body.className || '').trim();
    const gradeLevel = Number(body.gradeLevel) || extractGradeLevel(className);
    const liveClass = db
      .prepare('SELECT homeroom_teacher, companion_teacher FROM school_classes WHERE class_name = ?')
      .get(className) as { homeroom_teacher: string; companion_teacher: string } | undefined;
    const preset = getClassPreset(className);

    const homeroomTeacher = String(
      body.homeroomTeacher || liveClass?.homeroom_teacher || preset?.homeroomTeacher || ''
    ).trim();
    const companionTeacher = String(
      body.companionTeacher || liveClass?.companion_teacher || preset?.companionTeacher || ''
    ).trim();
    const activeRosterCount = (
      db
        .prepare('SELECT COUNT(*) as c FROM class_students WHERE class_name = ? AND archived_at IS NULL')
        .get(className) as { c: number }
    ).c;
    const studentCount = Number(body.studentCount || activeRosterCount || 10);
    const dayOfWeek = String(body.dayOfWeek || '').trim();
    const scheduleDate = body.scheduleDate ? String(body.scheduleDate).trim() : null;
    const startTime = String(body.startTime || '').trim();
    const endTime = String(body.endTime || '').trim();
    const roomArea = String(body.roomArea || '').trim();
    const readingMode = String(body.readingMode || 'Literasi Pagi').trim();
    const readingTheme = String(body.readingTheme || '').trim();
    const bookId = body.bookId ? Number(body.bookId) : null;
    const sessionNotes = String(body.sessionNotes || '').trim();

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
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const existingRows = db
      .prepare(
        `SELECT rs.*, b.title as book_title
         FROM reading_schedules rs
         LEFT JOIN books b ON b.id = rs.book_id
         WHERE rs.archived_at IS NULL`
      )
      .all() as SqlScheduleRow[];

    const conflict = detectScheduleConflict(
      { className, dayOfWeek, startTime, endTime, roomArea },
      existingRows.map(toDomainRecord)
    );
    if (conflict.hasConflict) {
      return NextResponse.json(
        { error: conflict.reason, conflict: true },
        { status: 409 }
      );
    }

    const created = db.transaction(() => {
      const maxId = (
        db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM reading_schedules').get() as { m: number }
      ).m;
      const scheduleCode = `JDW-2026-${String(maxId + 1).padStart(4, '0')}`;

      const id = Number(
        db
          .prepare(
            `INSERT INTO reading_schedules (
              schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count,
              day_of_week, schedule_date, start_time, end_time, room_area, reading_mode,
              reading_theme, book_id, status, session_notes, created_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Terjadwal', ?, ?)`
          )
          .run(
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
            bookId,
            sessionNotes,
            guard.user.id
          ).lastInsertRowid
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'SCHEDULE_CREATE',
        entityType: 'reading_schedules',
        entityId: scheduleCode,
        after: {
          className,
          homeroomTeacher,
          companionTeacher,
          dayOfWeek,
          startTime,
          endTime,
          roomArea,
          readingMode,
        },
      });

      return { id, scheduleCode };
    })();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal membuat jadwal baca.' },
      { status: 400 }
    );
  }
}
