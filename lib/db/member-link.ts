import type Database from 'better-sqlite3';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import { SCHOOL_ROLE_MAP } from '@/lib/domain/settings-backup-rules';
import { resolveMembershipTypeCodeForSignup } from '@/lib/domain/signup-rules';

export function generateNextMemberCode(db: Database.Database, prefix = 'AGT-2026-'): string {
  let seq =
    (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM members').get() as { m: number }).m + 1;
  let memberCode = `${prefix}${String(seq).padStart(4, '0')}`;
  const checkCode = db.prepare('SELECT 1 FROM members WHERE member_code = ?');
  while (checkCode.get(memberCode)) {
    seq++;
    memberCode = `${prefix}${String(seq).padStart(4, '0')}`;
  }
  return memberCode;
}

export function ensureMemberRecordForUser(
  db: Database.Database,
  params: {
    fullName: string;
    email: string;
    roleSlug: string;
    roleName: string;
    unitOrClass?: string;
    assignedClass?: string;
    gradeLevel?: number | null;
    identityNumber?: string;
    gender?: string;
    phone?: string;
    memberSubStatus?: string;
    memberCodePrefix?: string;
  }
): number | null {
  const roleDef = SCHOOL_ROLE_MAP.get(params.roleSlug);
  if (params.roleSlug === 'pengunjung') return null;

  const existing = db
    .prepare('SELECT id FROM members WHERE lower(email) = ? AND archived_at IS NULL LIMIT 1')
    .get(params.email.trim().toLowerCase()) as { id: number } | undefined;
  if (existing) return existing.id;

  const resolvedTypeCode =
    resolveMembershipTypeCodeForSignup({
      roleSlug: params.roleSlug,
      gradeLevel: params.gradeLevel,
      assignedClass: params.assignedClass || params.unitOrClass,
      memberSubStatus: params.memberSubStatus,
    }) ||
    roleDef?.defaultMembershipTypeCode ||
    'SISWA_TINGGI';

  const mType =
    (db
      .prepare('SELECT id FROM membership_types WHERE code = ? LIMIT 1')
      .get(resolvedTypeCode) as { id: number } | undefined) ||
    (db.prepare('SELECT id FROM membership_types ORDER BY id ASC LIMIT 1').get() as
      | { id: number }
      | undefined);
  if (!mType) return null;

  const today = formatIsoDate(new Date());
  const expiresAt = addDaysIso(today, 365);
  const memberCode = generateNextMemberCode(db, params.memberCodePrefix || 'AGT-2026-');
  const genderLabel =
    params.gender === 'L'
      ? 'Laki-laki'
      : params.gender === 'P'
        ? 'Perempuan'
        : params.gender || 'Tidak Disebutkan';

  const inserted = db
    .prepare(
      `INSERT INTO members (
         member_code, full_name, membership_type_id, identity_number, gender,
         unit_or_class, phone, email, registered_at, expires_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aktif')`
    )
    .run(
      memberCode,
      params.fullName,
      mType.id,
      params.identityNumber || '',
      genderLabel,
      params.unitOrClass || params.assignedClass || params.roleName,
      params.phone || '',
      params.email.trim().toLowerCase(),
      today,
      expiresAt
    );

  return Number(inserted.lastInsertRowid);
}

export function syncStudentToClassRoster(
  db: Database.Database,
  params: {
    className: string;
    fullName: string;
    identityNumber?: string;
    gender?: string;
  }
): { synced: boolean; studentId: number | null } {
  const className = params.className.trim();
  if (!className) return { synced: false, studentId: null };

  const classRow = db
    .prepare('SELECT class_name FROM school_classes WHERE class_name = ? AND archived_at IS NULL')
    .get(className) as { class_name: string } | undefined;
  if (!classRow) return { synced: false, studentId: null };

  const cleanGender = params.gender === 'P' ? 'P' : 'L';
  const existing = db
    .prepare(
      `SELECT id FROM class_students
       WHERE class_name = ? AND lower(full_name) = lower(?) AND archived_at IS NULL
       LIMIT 1`
    )
    .get(className, params.fullName.trim()) as { id: number } | undefined;

  if (existing) {
    return { synced: false, studentId: existing.id };
  }

  let studentCode = params.identityNumber?.trim() || '';
  if (studentCode) {
    const codeDup = db
      .prepare('SELECT 1 FROM class_students WHERE student_code = ?')
      .get(studentCode);
    if (codeDup) studentCode = '';
  }

  if (!studentCode) {
    const classTag = className.replace(/^Kelas\s+/i, '').replace(/\s+/g, '').toUpperCase() || 'SD';
    let seq =
      (
        db
          .prepare('SELECT COALESCE(MAX(id), 0) as m FROM class_students')
          .get() as { m: number }
      ).m + 1;
    studentCode = `NIS-${classTag}-${String(seq).padStart(3, '0')}`;
    const check = db.prepare('SELECT 1 FROM class_students WHERE student_code = ?');
    while (check.get(studentCode)) {
      seq++;
      studentCode = `NIS-${classTag}-${String(seq).padStart(3, '0')}`;
    }
  }

  const inserted = db
    .prepare(
      `INSERT INTO class_students (class_name, student_code, full_name, gender, status, notes)
       VALUES (?, ?, ?, ?, 'Aktif', 'Sinkron otomatis dari pendaftaran akun siswa')`
    )
    .run(className, studentCode, params.fullName.trim(), cleanGender);

  const activeCount = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM class_students WHERE class_name = ? AND archived_at IS NULL AND status = 'Aktif'"
      )
      .get(className) as { c: number }
  ).c;

  db.prepare(
    `UPDATE reading_schedules
     SET student_count = ?, updated_at = datetime('now')
     WHERE class_name = ? AND archived_at IS NULL`
  ).run(activeCount, className);

  return { synced: true, studentId: Number(inserted.lastInsertRowid) };
}

export function syncTeacherToClassAndSchedules(
  db: Database.Database,
  params: {
    className: string;
    slot: 'homeroom' | 'companion';
    teacherName: string;
    syncSchedules?: boolean;
  }
): { updatedClass: boolean; updatedSchedules: number } {
  const className = params.className.trim();
  const teacherName = params.teacherName.trim();
  if (!className || !teacherName) return { updatedClass: false, updatedSchedules: 0 };

  const classCol = params.slot === 'homeroom' ? 'homeroom_teacher' : 'companion_teacher';
  const classRes = db
    .prepare(
      `UPDATE school_classes
       SET ${classCol} = ?, updated_at = datetime('now')
       WHERE class_name = ? AND archived_at IS NULL`
    )
    .run(teacherName, className);

  let updatedSchedules = 0;
  if (params.syncSchedules !== false) {
    const schedRes = db
      .prepare(
        `UPDATE reading_schedules
         SET ${classCol} = ?, updated_at = datetime('now')
         WHERE class_name = ? AND archived_at IS NULL`
      )
      .run(teacherName, className);
    updatedSchedules = schedRes.changes;
  }

  return { updatedClass: classRes.changes > 0, updatedSchedules };
}
