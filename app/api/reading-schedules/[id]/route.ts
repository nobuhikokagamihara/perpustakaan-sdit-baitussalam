import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { formatIsoDate } from '@/lib/domain/library-rules';
import {
  SCHEDULE_STATUSES,
  detectScheduleConflict,
  extractGradeLevel,
  summarizeSessionAttendance,
  validateAttendanceEntries,
  validateCompletionLog,
  validateSchedulePayload,
  type AttendanceRecordItem,
  type AttendanceStatus,
  type ReadingScheduleRecord,
  type ScheduleStatus,
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
  book_title?: string | null;
  status: string;
  students_present: number;
  books_read_count: number;
  session_notes: string;
  completed_at: string | null;
  archived_at: string | null;
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

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const scheduleId = Number(id);
  if (!scheduleId) {
    return NextResponse.json({ error: 'ID jadwal tidak valid.' }, { status: 400 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM reading_schedules WHERE id = ? AND archived_at IS NULL')
      .get(scheduleId) as SqlScheduleRow | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Jadwal baca tidak ditemukan.' }, { status: 404 });
    }

    const className = String(body.className ?? existing.class_name).trim();
    const gradeLevel = Number(body.gradeLevel) || extractGradeLevel(className);
    const homeroomTeacher = String(body.homeroomTeacher ?? existing.homeroom_teacher).trim();
    const companionTeacher = String(body.companionTeacher ?? existing.companion_teacher).trim();
    const studentCount = Number(body.studentCount ?? existing.student_count);
    const dayOfWeek = String(body.dayOfWeek ?? existing.day_of_week).trim();
    const scheduleDate =
      body.scheduleDate !== undefined
        ? body.scheduleDate
          ? String(body.scheduleDate).trim()
          : null
        : existing.schedule_date;
    const startTime = String(body.startTime ?? existing.start_time).trim();
    const endTime = String(body.endTime ?? existing.end_time).trim();
    const roomArea = String(body.roomArea ?? existing.room_area).trim();
    const readingMode = String(body.readingMode ?? existing.reading_mode).trim();
    const readingTheme = String(body.readingTheme ?? existing.reading_theme).trim();
    const bookId = body.bookId !== undefined ? (body.bookId ? Number(body.bookId) : null) : existing.book_id;
    const sessionNotes = String(body.sessionNotes ?? existing.session_notes).trim();

    const validation = validateSchedulePayload({
      className,
      homeroomTeacher,
      companionTeacher: companionTeacher || undefined,
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

    const allActive = db
      .prepare(
        `SELECT rs.*, b.title as book_title
         FROM reading_schedules rs
         LEFT JOIN books b ON b.id = rs.book_id
         WHERE rs.archived_at IS NULL`
      )
      .all() as SqlScheduleRow[];

    const conflict = detectScheduleConflict(
      { id: scheduleId, className, dayOfWeek, startTime, endTime, roomArea },
      allActive.map(toDomainRecord)
    );
    if (conflict.hasConflict) {
      return NextResponse.json({ error: conflict.reason, conflict: true }, { status: 409 });
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE reading_schedules
         SET class_name = ?, grade_level = ?, homeroom_teacher = ?, companion_teacher = ?, student_count = ?,
             day_of_week = ?, schedule_date = ?, start_time = ?, end_time = ?,
             room_area = ?, reading_mode = ?, reading_theme = ?, book_id = ?,
             session_notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
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
        scheduleId
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'SCHEDULE_UPDATE',
        entityType: 'reading_schedules',
        entityId: existing.schedule_code,
        before: {
          className: existing.class_name,
          homeroomTeacher: existing.homeroom_teacher,
          companionTeacher: existing.companion_teacher,
          dayOfWeek: existing.day_of_week,
          startTime: existing.start_time,
          endTime: existing.end_time,
          roomArea: existing.room_area,
        },
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
    })();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui jadwal baca.' },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const scheduleId = Number(id);
  if (!scheduleId) {
    return NextResponse.json({ error: 'ID jadwal tidak valid.' }, { status: 400 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || 'log_session');
    const db = getDb();

    const existing = db
      .prepare('SELECT * FROM reading_schedules WHERE id = ? AND archived_at IS NULL')
      .get(scheduleId) as SqlScheduleRow | undefined;
    if (!existing) {
      return NextResponse.json({ error: 'Jadwal baca tidak ditemukan.' }, { status: 404 });
    }

    if (action === 'status') {
      const nextStatus = String(body.status || '') as ScheduleStatus;
      if (!SCHEDULE_STATUSES.includes(nextStatus)) {
        return NextResponse.json({ error: 'Status jadwal tidak valid.' }, { status: 400 });
      }
      if (existing.status === 'Dibatalkan' && nextStatus !== 'Dibatalkan') {
        const allActive = db
          .prepare('SELECT * FROM reading_schedules WHERE archived_at IS NULL')
          .all() as SqlScheduleRow[];
        const conflict = detectScheduleConflict(
          {
            id: scheduleId,
            className: existing.class_name,
            dayOfWeek: existing.day_of_week,
            startTime: existing.start_time,
            endTime: existing.end_time,
            roomArea: existing.room_area,
          },
          allActive.map(toDomainRecord)
        );
        if (conflict.hasConflict) {
          return NextResponse.json({ error: conflict.reason, conflict: true }, { status: 409 });
        }
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE reading_schedules
           SET status = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(nextStatus, scheduleId);

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'SCHEDULE_STATUS_CHANGE',
          entityType: 'reading_schedules',
          entityId: existing.schedule_code,
          before: { status: existing.status },
          after: { status: nextStatus },
        });
      })();

      return NextResponse.json({ ok: true, status: nextStatus });
    }

    // action === 'log_session'
    const nextStatus = String(body.status || 'Selesai');
    const notes = String(body.notes ?? '').trim();
    const sessionDate = String(body.sessionDate || formatIsoDate(new Date())).trim();
    const rawAttendance = Array.isArray(body.attendance)
      ? (body.attendance as Array<{
          studentId: number | string;
          status: string;
          booksRead?: number;
          note?: string;
        }>)
      : null;

    let resolvedAttendance: AttendanceRecordItem[] = [];
    let studentsPresent = Number(body.studentsPresent ?? existing.student_count);
    let booksReadCount = Number(body.booksReadCount ?? studentsPresent);
    let effectiveStudentCount = existing.student_count;

    if (rawAttendance && rawAttendance.length > 0) {
      const attCheck = validateAttendanceEntries(rawAttendance);
      if (!attCheck.ok) {
        return NextResponse.json({ error: attCheck.reason }, { status: 400 });
      }

      const classStudents = db
        .prepare(
          `SELECT id, student_code, full_name
           FROM class_students
           WHERE class_name = ? AND archived_at IS NULL`
        )
        .all(existing.class_name) as Array<{ id: number; student_code: string; full_name: string }>;
      const studentMap = new Map(classStudents.map((s) => [String(s.id), s]));

      resolvedAttendance = rawAttendance.map((item) => {
        const st = studentMap.get(String(item.studentId));
        if (!st) {
          throw new Error(`Siswa ID ${item.studentId} tidak ditemukan di ${existing.class_name}.`);
        }
        const stStatus = item.status as AttendanceStatus;
        return {
          studentId: st.id,
          studentCode: st.student_code,
          studentName: st.full_name,
          status: stStatus,
          booksRead: stStatus === 'Hadir' ? Math.max(0, Number(item.booksRead ?? 0)) : 0,
          note: String(item.note || '').trim().slice(0, 160),
        };
      });

      const attSummary = summarizeSessionAttendance(resolvedAttendance);
      studentsPresent = attSummary.presentCount;
      booksReadCount = attSummary.totalBooksRead;
      effectiveStudentCount = Math.max(existing.student_count, resolvedAttendance.length);
    }

    const check = validateCompletionLog({
      status: nextStatus,
      studentsPresent,
      studentCount: effectiveStudentCount,
      booksReadCount,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    db.transaction(() => {
      const completedAt =
        nextStatus === 'Selesai'
          ? `${sessionDate} ${new Date().toTimeString().slice(0, 8)}`
          : existing.completed_at;
      db.prepare(
        `UPDATE reading_schedules
         SET status = ?, student_count = ?, students_present = ?, books_read_count = ?, session_notes = ?,
             completed_at = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextStatus,
        effectiveStudentCount,
        studentsPresent,
        booksReadCount,
        notes,
        completedAt,
        scheduleId
      );

      const logId = Number(
        db
          .prepare(
            `INSERT INTO reading_schedule_logs (
               schedule_id, session_date, status, students_present, books_read_count, notes,
               recorded_by_user_id, recorded_by_name
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            scheduleId,
            sessionDate,
            nextStatus,
            studentsPresent,
            booksReadCount,
            notes,
            guard.user.id,
            guard.user.fullName
          ).lastInsertRowid
      );

      if (resolvedAttendance.length > 0) {
        const insAtt = db.prepare(`
          INSERT INTO reading_session_attendance (
            log_id, schedule_id, student_id, student_code, student_name, status, books_read, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const a of resolvedAttendance) {
          insAtt.run(
            logId,
            scheduleId,
            Number(a.studentId),
            a.studentCode,
            a.studentName,
            a.status,
            a.booksRead,
            a.note || ''
          );
        }
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'SCHEDULE_SESSION_LOG',
        entityType: 'reading_schedules',
        entityId: existing.schedule_code,
        after: {
          status: nextStatus,
          sessionDate,
          studentsPresent,
          booksReadCount,
          attendanceCount: resolvedAttendance.length,
        },
      });
    })();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal mencatat pelaksanaan sesi baca.' },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  const { id } = await context.params;
  const scheduleId = Number(id);
  if (!scheduleId) {
    return NextResponse.json({ error: 'ID jadwal tidak valid.' }, { status: 400 });
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT id, schedule_code, class_name FROM reading_schedules WHERE id = ? AND archived_at IS NULL')
    .get(scheduleId) as { id: number; schedule_code: string; class_name: string } | undefined;

  if (!existing) {
    return NextResponse.json({ error: 'Jadwal baca tidak ditemukan.' }, { status: 404 });
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE reading_schedules
       SET archived_at = datetime('now'), status = 'Dibatalkan', updated_at = datetime('now')
       WHERE id = ?`
    ).run(scheduleId);

    logAudit(db, {
      userId: guard.user.id,
      userName: guard.user.fullName,
      action: 'SCHEDULE_ARCHIVE',
      entityType: 'reading_schedules',
      entityId: existing.schedule_code,
      before: { className: existing.class_name },
    });
  })();

  return NextResponse.json({ ok: true });
}
