import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  SD_CLASSES,
  computeClassAttendanceRecap,
  validateStudentPayload,
  type AttendanceRecordItem,
  type AttendanceStatus,
  type ClassStudentRecord,
} from '@/lib/domain/reading-schedule-rules';

interface SqlSchoolClassRow {
  id: number;
  class_name: string;
  grade_level: number;
  homeroom_teacher: string;
  companion_teacher: string;
  active_student_count: number;
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

export async function GET(req: NextRequest) {
  const guard = await requirePermission('schedules.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const className = req.nextUrl.searchParams.get('className')?.trim() || '';

  const classRows = db
    .prepare(
      `SELECT sc.id, sc.class_name, sc.grade_level, sc.homeroom_teacher, sc.companion_teacher,
              (SELECT COUNT(*) FROM class_students cs WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL) as active_student_count
       FROM school_classes sc
       ORDER BY sc.grade_level ASC, sc.class_name ASC`
    )
    .all() as SqlSchoolClassRow[];

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
      className: c.class_name,
      gradeLevel: c.grade_level,
      homeroomTeacher: c.homeroom_teacher,
      companionTeacher: c.companion_teacher,
      activeStudentCount: c.active_student_count,
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
    const syncSchedules = body.syncSchedules !== false;

    if (!SD_CLASSES.some((c) => c.className === className)) {
      return NextResponse.json({ error: 'Nama kelas SD tidak valid.' }, { status: 400 });
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

    const db = getDb();
    const before = db
      .prepare('SELECT homeroom_teacher, companion_teacher FROM school_classes WHERE class_name = ?')
      .get(className) as { homeroom_teacher: string; companion_teacher: string } | undefined;

    if (!before) {
      return NextResponse.json({ error: 'Data kelas tidak ditemukan.' }, { status: 404 });
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE school_classes
         SET homeroom_teacher = ?, companion_teacher = ?, updated_at = datetime('now')
         WHERE class_name = ?`
      ).run(homeroomTeacher, companionTeacher, className);

      if (syncSchedules) {
        db.prepare(
          `UPDATE reading_schedules
           SET homeroom_teacher = ?, companion_teacher = ?, updated_at = datetime('now')
           WHERE class_name = ? AND archived_at IS NULL`
        ).run(homeroomTeacher, companionTeacher, className);
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'CLASS_TEACHERS_UPDATE',
        entityType: 'school_classes',
        entityId: className,
        before: {
          homeroomTeacher: before.homeroom_teacher,
          companionTeacher: before.companion_teacher,
        },
        after: { homeroomTeacher, companionTeacher, syncSchedules },
      });
    })();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal memperbarui wali kelas & pendamping.' },
      { status: 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('schedules.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const className = String(body.className || '').trim();
    const fullName = String(body.fullName || '').trim();
    const gender = String(body.gender || 'L').trim().toUpperCase() === 'P' ? 'P' : 'L';
    const rawCode = String(body.studentCode || '').trim();
    const notes = String(body.notes || '').trim();

    const check = validateStudentPayload({
      className,
      fullName,
      studentCode: rawCode || undefined,
      gender,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }

    const db = getDb();
    const created = db.transaction(() => {
      let studentCode = rawCode;
      if (!studentCode) {
        const shortCode = className.replace(/^Kelas\s+/i, '').toUpperCase();
        const existingInClass = (
          db
            .prepare('SELECT COUNT(*) as c FROM class_students WHERE class_name = ?')
            .get(className) as { c: number }
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
          .run(className, studentCode, fullName, gender, notes).lastInsertRowid
      );

      const activeCount = (
        db
          .prepare(
            'SELECT COUNT(*) as c FROM class_students WHERE class_name = ? AND archived_at IS NULL'
          )
          .get(className) as { c: number }
      ).c;

      db.prepare(
        `UPDATE reading_schedules
         SET student_count = ?, updated_at = datetime('now')
         WHERE class_name = ? AND archived_at IS NULL`
      ).run(activeCount, className);

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'CLASS_STUDENT_CREATE',
        entityType: 'class_students',
        entityId: studentCode,
        after: { id, className, studentCode, fullName, gender },
      });

      return { id, studentCode, activeCount };
    })();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal menambahkan data siswa.' },
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
    const studentId = Number(body.id);
    if (!studentId) {
      return NextResponse.json({ error: 'ID siswa tidak valid.' }, { status: 400 });
    }

    const db = getDb();
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
      { error: err instanceof Error ? err.message : 'Gagal memperbarui data siswa.' },
      { status: 400 }
    );
  }
}
