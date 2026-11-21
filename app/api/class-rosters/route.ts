import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  buildAutoClassScheduleSlots,
  compareClassNames,
  computeClassAttendanceRecap,
  parseBulkStudentLines,
  validateRombelPayload,
  validateStudentPayload,
  type AttendanceRecordItem,
  type AttendanceStatus,
  type ClassStudentRecord,
  type ReadingScheduleRecord,
  type SdClassPreset,
} from '@/lib/domain/reading-schedule-rules';

interface SqlSchoolClassRow {
  id: number;
  class_name: string;
  grade_level: number;
  homeroom_teacher: string;
  companion_teacher: string;
  room_label: string;
  notes: string;
  archived_at: string | null;
  active_student_count: number;
  schedule_count: number;
  member_count: number;
}

interface SqlStudentRow {
  id: number;
  class_name: string;
  student_code: string;
  full_name: string;
  gender: 'L' | 'P';
  status: 'Aktif' | 'Nonaktif';
  notes: string;
  archived_at: string | null;
}

interface SqlAttendanceRow {
  log_id: number;
  student_id: number;
  student_code: string;
  student_name: string;
  status: AttendanceStatus;
  books_read: number;
  note: string;
}

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
  status: string;
  students_present: number;
  books_read_count: number;
  session_notes: string;
  archived_at: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission('schedules.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const className = req.nextUrl.searchParams.get('className')?.trim() || '';
  const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';

  const classRows = db
    .prepare(
      `SELECT sc.id, sc.class_name, sc.grade_level, sc.homeroom_teacher, sc.companion_teacher,
              sc.room_label, sc.notes, sc.archived_at,
              (SELECT COUNT(*) FROM class_students cs WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL) as active_student_count,
              (SELECT COUNT(*) FROM reading_schedules rs WHERE rs.class_name = sc.class_name AND rs.archived_at IS NULL AND rs.status != 'Dibatalkan') as schedule_count,
              (SELECT COUNT(*) FROM members m WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(sc.class_name)) AND m.archived_at IS NULL) as member_count
       FROM school_classes sc
       ${includeArchived ? '' : 'WHERE sc.archived_at IS NULL'}
       ORDER BY sc.grade_level ASC, sc.class_name ASC`
    )
    .all() as SqlSchoolClassRow[];

  classRows.sort((a, b) => compareClassNames(a.class_name, b.class_name));

  const studentRows = (
    className
      ? db
          .prepare(
            `SELECT id, class_name, student_code, full_name, gender, status, notes, archived_at
             FROM class_students
             WHERE archived_at IS NULL AND class_name = ?
             ORDER BY student_code ASC, full_name ASC`
          )
          .all(className)
      : db
          .prepare(
            `SELECT id, class_name, student_code, full_name, gender, status, notes, archived_at
             FROM class_students
             WHERE archived_at IS NULL
             ORDER BY class_name ASC, student_code ASC, full_name ASC`
          )
          .all()
  ) as SqlStudentRow[];

  const studentIds = studentRows.map((s) => s.id);
  const attGroupsByLog = new Map<number, AttendanceRecordItem[]>();

  if (studentIds.length > 0) {
    const placeholders = studentIds.map(() => '?').join(',');
    const attRows = db
      .prepare(
        `SELECT log_id, student_id, student_code, student_name, status, books_read, note
         FROM reading_session_attendance
         WHERE student_id IN (${placeholders})
         ORDER BY log_id ASC`
      )
      .all(...studentIds) as SqlAttendanceRow[];

    for (const r of attRows) {
      const list = attGroupsByLog.get(r.log_id) || [];
      list.push({
        studentId: r.student_id,
        studentCode: r.student_code,
        studentName: r.student_name,
        status: r.status,
        booksRead: r.books_read,
        note: r.note,
      });
      attGroupsByLog.set(r.log_id, list);
    }
  }

  const domainStudents: ClassStudentRecord[] = studentRows.map((s) => ({
    id: s.id,
    className: s.class_name,
    studentCode: s.student_code,
    fullName: s.full_name,
    gender: s.gender === 'P' ? 'P' : 'L',
    status: s.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
    notes: s.notes,
    archived: Boolean(s.archived_at),
  }));

  const studentRecap = computeClassAttendanceRecap(
    domainStudents,
    Array.from(attGroupsByLog.values())
  );

  return NextResponse.json({
    classes: classRows.map((c) => ({
      id: c.id,
      className: c.class_name,
      gradeLevel: c.grade_level,
      homeroomTeacher: c.homeroom_teacher,
      companionTeacher: c.companion_teacher,
      roomLabel: c.room_label || '',
      notes: c.notes || '',
      archived: Boolean(c.archived_at),
      activeStudentCount: c.active_student_count,
      scheduleCount: c.schedule_count,
      memberCount: c.member_count,
    })),
    students: domainStudents,
    studentRecap,
  });
}

export async function PUT(req: NextRequest) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const className = String(body.className || '').trim();
    const homeroomTeacher = String(body.homeroomTeacher || '').trim();
    const companionTeacher = String(body.companionTeacher || '').trim();
    const roomLabel = body.roomLabel !== undefined ? String(body.roomLabel || '').trim() : undefined;
    const notes = body.notes !== undefined ? String(body.notes || '').trim() : undefined;
    const syncSchedules = body.syncSchedules !== false;

    if (!className) {
      return NextResponse.json({ error: 'Nama rombel kelas wajib diisi.' }, { status: 400 });
    }
    if (homeroomTeacher.length < 3 || homeroomTeacher.length > 120) {
      return NextResponse.json(
        { error: 'Nama wali kelas harus antara 3 hingga 120 karakter.' },
        { status: 400 }
      );
    }
    if (companionTeacher.length < 3 || companionTeacher.length > 120) {
      return NextResponse.json(
        { error: 'Nama guru pendamping harus antara 3 hingga 120 karakter.' },
        { status: 400 }
      );
    }
    if (roomLabel !== undefined && roomLabel.length > 60) {
      return NextResponse.json(
        { error: 'Nama ruang kelas maksimal 60 karakter.' },
        { status: 400 }
      );
    }
    if (notes !== undefined && notes.length > 240) {
      return NextResponse.json(
        { error: 'Catatan rombel maksimal 240 karakter.' },
        { status: 400 }
      );
    }

    const db = getDb();
    const before = db
      .prepare(
        `SELECT class_name, homeroom_teacher, companion_teacher, room_label, notes, archived_at
         FROM school_classes
         WHERE LOWER(class_name) = LOWER(?)`
      )
      .get(className) as
      | {
          class_name: string;
          homeroom_teacher: string;
          companion_teacher: string;
          room_label: string;
          notes: string;
          archived_at: string | null;
        }
      | undefined;

    if (!before || before.archived_at) {
      return NextResponse.json(
        { error: 'Data rombel kelas tidak ditemukan atau sudah diarsipkan.' },
        { status: 404 }
      );
    }

    const finalRoomLabel = roomLabel !== undefined ? roomLabel : before.room_label;
    const finalNotes = notes !== undefined ? notes : before.notes;

    db.transaction(() => {
      db.prepare(
        `UPDATE school_classes
         SET homeroom_teacher = ?, companion_teacher = ?, room_label = ?, notes = ?, updated_at = datetime('now')
         WHERE class_name = ?`
      ).run(homeroomTeacher, companionTeacher, finalRoomLabel, finalNotes, before.class_name);

      if (syncSchedules) {
        db.prepare(
          `UPDATE reading_schedules
           SET homeroom_teacher = ?, companion_teacher = ?, updated_at = datetime('now')
           WHERE class_name = ? AND archived_at IS NULL`
        ).run(homeroomTeacher, companionTeacher, before.class_name);
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'CLASS_TEACHERS_UPDATE',
        entityType: 'school_classes',
        entityId: before.class_name,
        before: {
          homeroomTeacher: before.homeroom_teacher,
          companionTeacher: before.companion_teacher,
          roomLabel: before.room_label,
          notes: before.notes,
        },
        after: {
          homeroomTeacher,
          companionTeacher,
          roomLabel: finalRoomLabel,
          notes: finalNotes,
          syncSchedules,
        },
      });
    })();

    return NextResponse.json({ ok: true, className: before.class_name });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui informasi rombel kelas.' },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || 'create_student').trim();
    const db = getDb();

    if (action === 'create_class' || action === 'create_rombel') {
      const check = validateRombelPayload({
        gradeLevel: body.gradeLevel as number | string | undefined,
        section: body.section !== undefined ? String(body.section) : undefined,
        className: body.className !== undefined ? String(body.className) : undefined,
        homeroomTeacher: String(body.homeroomTeacher || ''),
        companionTeacher: String(body.companionTeacher || ''),
        roomLabel: body.roomLabel !== undefined ? String(body.roomLabel) : '',
        notes: body.notes !== undefined ? String(body.notes) : '',
      });

      if (!check.ok || !check.normalized) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }

      const norm = check.normalized;
      const existing = db
        .prepare(
          'SELECT id, class_name, archived_at FROM school_classes WHERE LOWER(class_name) = LOWER(?)'
        )
        .get(norm.className) as
        | { id: number; class_name: string; archived_at: string | null }
        | undefined;

      if (existing) {
        if (existing.archived_at) {
          return NextResponse.json(
            {
              error: `Rombel "${existing.class_name}" pernah diarsipkan. Anda dapat memulihkannya dari daftar arsip rombel.`,
              archivedExists: true,
              className: existing.class_name,
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: `Rombel "${existing.class_name}" sudah terdaftar di sistem.` },
          { status: 409 }
        );
      }

      const autoCreateSchedule = body.autoCreateSchedule === true;
      const bulkStudentsInput =
        typeof body.initialStudentsText === 'string' && body.initialStudentsText.trim()
          ? parseBulkStudentLines(body.initialStudentsText)
          : Array.isArray(body.initialStudents)
            ? (body.initialStudents as Array<{
                fullName?: string;
                gender?: string;
                studentCode?: string;
              }>)
                .map((s) => ({
                  fullName: String(s.fullName || '').trim(),
                  gender: (String(s.gender || 'L').toUpperCase() === 'P' ? 'P' : 'L') as 'L' | 'P',
                  studentCode: s.studentCode ? String(s.studentCode).trim() : undefined,
                }))
                .filter((s) => s.fullName.length >= 2)
            : [];

      const created = db.transaction(() => {
        const classId = Number(
          db
            .prepare(
              `INSERT INTO school_classes (
                 class_name, grade_level, homeroom_teacher, companion_teacher, room_label, notes
               ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              norm.className,
              norm.gradeLevel,
              norm.homeroomTeacher,
              norm.companionTeacher,
              norm.roomLabel,
              norm.notes
            ).lastInsertRowid
        );

        let createdStudentsCount = 0;
        const shortCode = norm.className
          .replace(/^Kelas\s+/i, '')
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase();
        let studentSeq = 1;

        for (const st of bulkStudentsInput.slice(0, 60)) {
          let code = st.studentCode || '';
          if (!code) {
            while (true) {
              const candidate = `NIS-${shortCode}-${String(studentSeq).padStart(2, '0')}`;
              const dup = db
                .prepare('SELECT id FROM class_students WHERE student_code = ?')
                .get(candidate);
              if (!dup) {
                code = candidate;
                studentSeq++;
                break;
              }
              studentSeq++;
            }
          } else {
            const dup = db
              .prepare('SELECT id FROM class_students WHERE student_code = ?')
              .get(code);
            if (dup) {
              throw new Error(`Kode/NIS siswa "${code}" sudah terdaftar.`);
            }
          }

          db.prepare(
            `INSERT INTO class_students (class_name, student_code, full_name, gender, status, notes)
             VALUES (?, ?, ?, ?, 'Aktif', '')`
          ).run(norm.className, code, st.fullName, st.gender);
          createdStudentsCount += 1;
        }

        let createdScheduleCode: string | null = null;
        if (autoCreateSchedule) {
          const existingSchedules = db
            .prepare('SELECT * FROM reading_schedules WHERE archived_at IS NULL')
            .all() as SqlScheduleRow[];

          const domainSchedules: ReadingScheduleRecord[] = existingSchedules.map((r) => ({
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
            status: r.status,
            studentsPresent: r.students_present,
            booksReadCount: r.books_read_count,
            sessionNotes: r.session_notes,
            archived: Boolean(r.archived_at),
          }));

          const defaultBook = db
            .prepare('SELECT id, title FROM books WHERE archived_at IS NULL ORDER BY id ASC LIMIT 1')
            .get() as { id: number; title: string } | undefined;

          const newPreset: SdClassPreset = {
            className: norm.className,
            gradeLevel: norm.gradeLevel,
            homeroomTeacher: norm.homeroomTeacher,
            companionTeacher: norm.companionTeacher,
            studentCount: createdStudentsCount > 0 ? createdStudentsCount : 20,
          };

          const slots = buildAutoClassScheduleSlots(
            domainSchedules,
            defaultBook ?? null,
            [newPreset]
          );

          if (slots.length > 0) {
            const slot = slots[0];
            const maxId = (
              db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM reading_schedules').get() as {
                m: number;
              }
            ).m;
            createdScheduleCode = `JDW-2026-${String(maxId + 1).padStart(4, '0')}`;

            db.prepare(
              `INSERT INTO reading_schedules (
                 schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count,
                 day_of_week, start_time, end_time, room_area, reading_mode, reading_theme,
                 book_id, status, created_by_user_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Terjadwal', ?)`
            ).run(
              createdScheduleCode,
              slot.className,
              slot.gradeLevel,
              slot.homeroomTeacher,
              slot.companionTeacher,
              slot.studentCount,
              slot.dayOfWeek,
              slot.startTime,
              slot.endTime,
              slot.roomArea,
              slot.readingMode,
              slot.readingTheme,
              slot.bookId,
              guard.user.id
            );
          }
        }

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'CLASS_ROMBEL_CREATE',
          entityType: 'school_classes',
          entityId: norm.className,
          after: {
            id: classId,
            ...norm,
            createdStudentsCount,
            createdScheduleCode,
          },
        });

        return {
          id: classId,
          ...norm,
          createdStudentsCount,
          createdScheduleCode,
        };
      })();

      return NextResponse.json(created, { status: 201 });
    }

    // Default: create student in an active rombel
    const className = String(body.className || '').trim();
    const fullName = String(body.fullName || '').trim();
    const gender = String(body.gender || 'L').trim().toUpperCase() === 'P' ? 'P' : 'L';
    const rawCode = String(body.studentCode || '').trim();
    const notes = String(body.notes || '').trim();

    const activeClassRows = db
      .prepare('SELECT class_name FROM school_classes WHERE archived_at IS NULL')
      .all() as Array<{ class_name: string }>;
    const allowedClassNames = activeClassRows.map((c) => c.class_name);

    const check = validateStudentPayload(
      {
        className,
        fullName,
        studentCode: rawCode || undefined,
        gender,
      },
      allowedClassNames
    );
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const canonicalClass =
      allowedClassNames.find((c) => c.toLowerCase() === className.toLowerCase()) || className;

    const created = db.transaction(() => {
      let studentCode = rawCode;
      if (!studentCode) {
        const shortCode = canonicalClass
          .replace(/^Kelas\s+/i, '')
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase();
        const existingInClass = (
          db
            .prepare('SELECT COUNT(*) as c FROM class_students WHERE class_name = ?')
            .get(canonicalClass) as { c: number }
        ).c;
        let seq = existingInClass + 1;
        while (true) {
          const candidate = `NIS-${shortCode}-${String(seq).padStart(2, '0')}`;
          const dup = db
            .prepare('SELECT id FROM class_students WHERE student_code = ?')
            .get(candidate);
          if (!dup) {
            studentCode = candidate;
            break;
          }
          seq++;
        }
      } else {
        const dup = db
          .prepare('SELECT id FROM class_students WHERE student_code = ?')
          .get(studentCode);
        if (dup) {
          throw new Error(`Kode/NIS siswa "${studentCode}" sudah terdaftar.`);
        }
      }

      const id = Number(
        db
          .prepare(
            `INSERT INTO class_students (class_name, student_code, full_name, gender, status, notes)
             VALUES (?, ?, ?, ?, 'Aktif', ?)`
          )
          .run(canonicalClass, studentCode, fullName, gender, notes).lastInsertRowid
      );

      const activeCount = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM class_students WHERE class_name = ? AND archived_at IS NULL'
          )
          .get(canonicalClass) as { c: number }
      ).c;

      db.prepare(
        `UPDATE reading_schedules
         SET student_count = ?, updated_at = datetime('now')
         WHERE class_name = ? AND archived_at IS NULL`
      ).run(activeCount, canonicalClass);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'CLASS_STUDENT_CREATE',
        entityType: 'class_students',
        entityId: studentCode,
        after: { id, className: canonicalClass, studentCode, fullName, gender },
      });

      return { id, studentCode, activeCount };
    })();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menyimpan data kelas/siswa.' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || 'update');
    const db = getDb();

    if (action === 'archive_class') {
      const className = String(body.className || '').trim();
      const archiveSchedules = body.archiveSchedules !== false;
      if (!className) {
        return NextResponse.json({ error: 'Nama rombel kelas wajib diisi.' }, { status: 400 });
      }

      const existingClass = db
        .prepare(
          'SELECT id, class_name, archived_at FROM school_classes WHERE LOWER(class_name) = LOWER(?)'
        )
        .get(className) as
        | { id: number; class_name: string; archived_at: string | null }
        | undefined;

      if (!existingClass || existingClass.archived_at) {
        return NextResponse.json(
          { error: 'Rombel kelas tidak ditemukan atau sudah diarsipkan.' },
          { status: 404 }
        );
      }

      const activeTotal = (
        db
          .prepare('SELECT COUNT(*) as c FROM school_classes WHERE archived_at IS NULL')
          .get() as { c: number }
      ).c;
      if (activeTotal <= 1) {
        return NextResponse.json(
          { error: 'Minimal harus ada 1 rombel kelas aktif di sekolah.' },
          { status: 400 }
        );
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE school_classes
           SET archived_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        ).run(existingClass.id);

        if (archiveSchedules) {
          db.prepare(
            `UPDATE reading_schedules
             SET archived_at = datetime('now'), updated_at = datetime('now')
             WHERE class_name = ? AND archived_at IS NULL`
          ).run(existingClass.class_name);
        }

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'CLASS_ROMBEL_ARCHIVE',
          entityType: 'school_classes',
          entityId: existingClass.class_name,
          before: { className: existingClass.class_name, archived: false },
          after: { className: existingClass.class_name, archived: true, archiveSchedules },
        });
      })();

      return NextResponse.json({ ok: true, className: existingClass.class_name });
    }

    if (action === 'restore_class') {
      const className = String(body.className || '').trim();
      if (!className) {
        return NextResponse.json({ error: 'Nama rombel kelas wajib diisi.' }, { status: 400 });
      }

      const existingClass = db
        .prepare(
          'SELECT id, class_name, archived_at FROM school_classes WHERE LOWER(class_name) = LOWER(?)'
        )
        .get(className) as
        | { id: number; class_name: string; archived_at: string | null }
        | undefined;

      if (!existingClass) {
        return NextResponse.json({ error: 'Rombel kelas tidak ditemukan.' }, { status: 404 });
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE school_classes
           SET archived_at = NULL, updated_at = datetime('now')
           WHERE id = ?`
        ).run(existingClass.id);

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'CLASS_ROMBEL_RESTORE',
          entityType: 'school_classes',
          entityId: existingClass.class_name,
          before: { archived: Boolean(existingClass.archived_at) },
          after: { archived: false },
        });
      })();

      return NextResponse.json({ ok: true, className: existingClass.class_name });
    }

    const studentId = Number(body.id);
    if (!studentId) {
      return NextResponse.json({ error: 'ID siswa tidak valid.' }, { status: 400 });
    }

    const existing = db
      .prepare('SELECT * FROM class_students WHERE id = ? AND archived_at IS NULL')
      .get(studentId) as SqlStudentRow | undefined;

    if (!existing) {
      return NextResponse.json({ error: 'Data siswa tidak ditemukan.' }, { status: 404 });
    }

    if (action === 'archive') {
      db.transaction(() => {
        db.prepare(
          `UPDATE class_students
           SET archived_at = datetime('now'), status = 'Nonaktif', updated_at = datetime('now')
           WHERE id = ?`
        ).run(studentId);

        const activeCount = (
          db
            .prepare(
              'SELECT COUNT(*) as c FROM class_students WHERE class_name = ? AND archived_at IS NULL'
            )
            .get(existing.class_name) as { c: number }
        ).c;

        if (activeCount > 0) {
          db.prepare(
            `UPDATE reading_schedules
             SET student_count = ?, updated_at = datetime('now')
             WHERE class_name = ? AND archived_at IS NULL`
          ).run(activeCount, existing.class_name);
        }

        logAudit(db, {
          userId: guard.user.id,
          userName: guard.user.fullName,
          action: 'CLASS_STUDENT_ARCHIVE',
          entityType: 'class_students',
          entityId: existing.student_code,
          before: { className: existing.class_name, fullName: existing.full_name },
        });
      })();

      return NextResponse.json({ ok: true });
    }

    // action === 'update'
    const fullName = String(body.fullName ?? existing.full_name).trim();
    const studentCode = String(body.studentCode ?? existing.student_code).trim();
    const gender = String(body.gender ?? existing.gender).trim().toUpperCase() === 'P' ? 'P' : 'L';
    const notes = String(body.notes ?? existing.notes).trim();

    const check = validateStudentPayload({
      className: existing.class_name,
      fullName,
      studentCode,
      gender,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const dup = db
      .prepare('SELECT id FROM class_students WHERE student_code = ? AND id != ?')
      .get(studentCode, studentId);
    if (dup) {
      return NextResponse.json(
        { error: `Kode/NIS siswa "${studentCode}" sudah digunakan siswa lain.` },
        { status: 409 }
      );
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE class_students
         SET full_name = ?, student_code = ?, gender = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(fullName, studentCode, gender, notes, studentId);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'CLASS_STUDENT_UPDATE',
        entityType: 'class_students',
        entityId: studentCode,
        before: {
          fullName: existing.full_name,
          studentCode: existing.student_code,
          gender: existing.gender,
        },
        after: { fullName, studentCode, gender, notes },
      });
    })();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui data kelas/siswa.' },
      { status: 400 }
    );
  }
}
