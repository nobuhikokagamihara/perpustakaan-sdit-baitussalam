import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { hashPassword, signSessionToken } from '@/lib/auth/crypto';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import {
  ensureMemberRecordForUser,
  syncStudentToClassRoster,
  syncTeacherToClassAndSchedules,
} from '@/lib/db/member-link';
import {
  doesRoleRequireApproval,
  validateSignupInput,
} from '@/lib/domain/settings-backup-rules';
import { compareClassNames } from '@/lib/domain/reading-schedule-rules';
import {
  buildRegistrationRequestCode,
  detectClassTeacherConflict,
  detectLibraryLeadershipConflict,
  isPlaceholderTeacherName,
  normalizeTeacherDisplay,
  validateRoleSpecificSignupFields,
} from '@/lib/domain/signup-rules';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(req.url);
    const checkCode = String(searchParams.get('checkCode') || '').trim().toUpperCase();
    const checkEmail = String(searchParams.get('checkEmail') || '').trim().toLowerCase();

    if (checkCode || checkEmail) {
      const reqRow = (
        checkCode
          ? db
              .prepare(
                `SELECT rr.request_code, rr.status, rr.requested_role_slug, r.name as role_name,
                        rr.assigned_class, rr.has_conflict, rr.conflict_type, rr.conflict_summary,
                        rr.decision_note, rr.reviewed_by_name, rr.reviewed_at, rr.created_at
                 FROM registration_requests rr
                 JOIN roles r ON r.id = rr.requested_role_id
                 WHERE upper(rr.request_code) = ?
                 ORDER BY rr.id DESC LIMIT 1`
              )
              .get(checkCode)
          : db
              .prepare(
                `SELECT rr.request_code, rr.status, rr.requested_role_slug, r.name as role_name,
                        rr.assigned_class, rr.has_conflict, rr.conflict_type, rr.conflict_summary,
                        rr.decision_note, rr.reviewed_by_name, rr.reviewed_at, rr.created_at
                 FROM registration_requests rr
                 JOIN roles r ON r.id = rr.requested_role_id
                 WHERE lower(rr.email) = ?
                 ORDER BY rr.id DESC LIMIT 1`
              )
              .get(checkEmail)
      ) as
        | {
            request_code: string;
            status: string;
            requested_role_slug: string;
            role_name: string;
            assigned_class: string;
            has_conflict: number;
            conflict_type: string;
            conflict_summary: string;
            decision_note: string;
            reviewed_by_name: string;
            reviewed_at: string | null;
            created_at: string;
          }
        | undefined;

      if (!reqRow) {
        return NextResponse.json(
          { found: false, message: 'Permintaan pendaftaran dengan kode atau email tersebut tidak ditemukan.' },
          { status: 200 }
        );
      }

      return NextResponse.json({
        found: true,
        request: {
          requestCode: reqRow.request_code,
          status: reqRow.status,
          roleSlug: reqRow.requested_role_slug,
          roleName: reqRow.role_name,
          assignedClass: reqRow.assigned_class,
          hasConflict: reqRow.has_conflict === 1,
          conflictType: reqRow.conflict_type,
          conflictSummary: reqRow.conflict_summary,
          decisionNote: reqRow.decision_note,
          reviewedByName: reqRow.reviewed_by_name,
          reviewedAt: reqRow.reviewed_at,
          createdAt: reqRow.created_at,
        },
      });
    }

    const roles = db
      .prepare(
        `SELECT id, slug, name, description, category, requires_approval
         FROM roles
         WHERE slug != 'super_admin'
         ORDER BY id ASC`
      )
      .all() as Array<{
      id: number;
      slug: string;
      name: string;
      description: string;
      category: string;
      requires_approval: number;
    }>;

    const rawClasses = db
      .prepare(
        `SELECT sc.id, sc.class_name, sc.grade_level, sc.homeroom_teacher, sc.companion_teacher,
                (SELECT COUNT(*) FROM class_students cs
                 WHERE cs.class_name = sc.class_name AND cs.archived_at IS NULL AND cs.status = 'Aktif') as student_count
         FROM school_classes sc
         WHERE sc.archived_at IS NULL`
      )
      .all() as Array<{
      id: number;
      class_name: string;
      grade_level: number;
      homeroom_teacher: string;
      companion_teacher: string;
      student_count: number;
    }>;

    const classes = rawClasses
      .sort((a, b) => compareClassNames(a.class_name, b.class_name))
      .map((c) => {
        const homeroom = normalizeTeacherDisplay(c.homeroom_teacher);
        const companion = normalizeTeacherDisplay(c.companion_teacher);
        return {
          id: c.id,
          className: c.class_name,
          gradeLevel: c.grade_level,
          homeroomTeacher: homeroom,
          companionTeacher: companion,
          hasHomeroomTeacher: !isPlaceholderTeacherName(c.homeroom_teacher),
          hasCompanionTeacher: !isPlaceholderTeacherName(c.companion_teacher),
          studentCount: c.student_count,
        };
      });

    return NextResponse.json({
      roles: roles.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        category: r.category || 'Warga Sekolah',
        requiresApproval: doesRoleRequireApproval(r.slug, r.requires_approval),
      })),
      classes,
    });
  } catch (err) {
    console.error('Load signup metadata error:', err);
    return NextResponse.json({ error: 'Gagal memuat daftar peran dan kelas sekolah.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const rl = checkRateLimit(`signup:${ip}`, 15, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan pendaftaran. Coba lagi dalam ${rl.retryAfterSec} detik.` },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const roleSlugRaw = String(body.roleSlug || '').trim();
    const roleIdRaw = body.roleId ? Number(body.roleId) : 0;

    const db = getDb();
    const roleRow = (
      roleSlugRaw
        ? db
            .prepare('SELECT id, slug, name, requires_approval FROM roles WHERE slug = ?')
            .get(roleSlugRaw)
        : db
            .prepare('SELECT id, slug, name, requires_approval FROM roles WHERE id = ?')
            .get(roleIdRaw)
    ) as
      | { id: number; slug: string; name: string; requires_approval: number }
      | undefined;

    if (!roleRow || roleRow.slug === 'super_admin') {
      return NextResponse.json(
        { error: 'Peran yang dipilih tidak valid atau tidak tersedia untuk pendaftaran mandiri.' },
        { status: 400 }
      );
    }

    const validation = validateSignupInput({
      fullName: String(body.fullName || ''),
      email: String(body.email || ''),
      username: typeof body.username === 'string' ? body.username : '',
      password: String(body.password || ''),
      roleSlug: roleRow.slug,
    });

    if (
      !validation.ok ||
      !validation.cleanFullName ||
      !validation.cleanEmail ||
      !validation.cleanUsername
    ) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const { cleanFullName, cleanEmail, cleanUsername } = validation;

    const activeClasses = db
      .prepare(
        `SELECT id, class_name, grade_level, homeroom_teacher, companion_teacher
         FROM school_classes
         WHERE archived_at IS NULL`
      )
      .all() as Array<{
      id: number;
      class_name: string;
      grade_level: number;
      homeroom_teacher: string;
      companion_teacher: string;
    }>;

    const roleFields = validateRoleSpecificSignupFields(
      {
        roleSlug: roleRow.slug,
        fullName: cleanFullName,
        assignedClass:
          typeof body.assignedClass === 'string'
            ? body.assignedClass
            : typeof body.unitOrClass === 'string'
              ? body.unitOrClass
              : '',
        identityNumber: typeof body.identityNumber === 'string' ? body.identityNumber : '',
        gender: typeof body.gender === 'string' ? body.gender : '',
        phone: typeof body.phone === 'string' ? body.phone : '',
        extraMeta:
          body.extraMeta && typeof body.extraMeta === 'object'
            ? (body.extraMeta as Record<string, string>)
            : {},
      },
      activeClasses.map((c) => c.class_name)
    );

    if (!roleFields.valid) {
      return NextResponse.json({ error: roleFields.error }, { status: 400 });
    }

    const existingUser = db
      .prepare('SELECT id, username, email FROM users WHERE lower(email) = ? OR lower(username) = ?')
      .get(cleanEmail, cleanUsername) as
      | { id: number; username: string; email: string }
      | undefined;

    if (existingUser) {
      const conflictField =
        existingUser.email.toLowerCase() === cleanEmail ? 'Email' : 'Username';
      return NextResponse.json(
        { error: `${conflictField} sudah terdaftar sebagai akun aktif. Silakan masuk atau gunakan akun lain.` },
        { status: 409 }
      );
    }

    const existingPending = db
      .prepare(
        `SELECT id, request_code, email, username
         FROM registration_requests
         WHERE status = 'pending' AND (lower(email) = ? OR lower(username) = ?)
         LIMIT 1`
      )
      .get(cleanEmail, cleanUsername) as
      | { id: number; request_code: string; email: string; username: string }
      | undefined;

    if (existingPending) {
      return NextResponse.json(
        {
          error: `Permintaan pendaftaran dengan email/username ini sudah ada dan masih berstatus Pending (Kode: ${existingPending.request_code}). Menunggu keputusan Super Admin / Admin / Kepala Perpustakaan.`,
          requestCode: existingPending.request_code,
          pendingApproval: true,
        },
        { status: 409 }
      );
    }

    const passwordHash = hashPassword(String(body.password || ''));
    const settings = getSettingsMap(db);
    const prefix = settings.member_code_prefix || 'AGT-2026-';

    const selectedClassRow = roleFields.normalizedClass
      ? activeClasses.find((c) => c.class_name === roleFields.normalizedClass) || null
      : null;

    // Check existing active user assigned to same class & teacher role
    const existingClassHolder =
      (roleRow.slug === 'wali_kelas' || roleRow.slug === 'guru_pendamping') &&
      roleFields.normalizedClass
        ? (db
            .prepare(
              `SELECT u.id, u.full_name, u.email
               FROM users u
               JOIN roles r ON r.id = u.role_id
               WHERE r.slug = ? AND u.assigned_class = ? AND u.is_active = 1 AND u.approval_status = 'approved'
               LIMIT 1`
            )
            .get(roleRow.slug, roleFields.normalizedClass) as
            | { id: number; full_name: string; email: string }
            | undefined)
        : undefined;

    const classConflict = detectClassTeacherConflict({
      roleSlug: roleRow.slug,
      selectedClass: roleFields.normalizedClass,
      applicantFullName: cleanFullName,
      classRecord: selectedClassRow
        ? {
            className: selectedClassRow.class_name,
            homeroomTeacher: selectedClassRow.homeroom_teacher,
            companionTeacher: selectedClassRow.companion_teacher,
          }
        : null,
      existingActiveHolder: existingClassHolder
        ? {
            userId: existingClassHolder.id,
            fullName: existingClassHolder.full_name,
            email: existingClassHolder.email,
          }
        : null,
    });

    const leadershipConflict = detectLibraryLeadershipConflict({
      roleSlug: roleRow.slug,
      applicantFullName: cleanFullName,
      principalName: settings.principal_name,
      librarianHeadName: settings.librarian_head_name,
    });

    const effectiveConflict = classConflict.hasConflict
      ? classConflict
      : leadershipConflict.hasConflict
        ? leadershipConflict
        : classConflict;

    const roleRequiresApproval = doesRoleRequireApproval(roleRow.slug, roleRow.requires_approval);
    const mustQueuePending = roleRequiresApproval || classConflict.hasConflict;

    // CASE 1: Needs approval or has data conflict -> Store ONLY in registration_requests (status = 'pending').
    // Do NOT insert into users/members and do NOT mutate school_classes/reading_schedules!
    if (mustQueuePending) {
      let requestCode = buildRegistrationRequestCode();
      const checkReqCode = db.prepare('SELECT 1 FROM registration_requests WHERE request_code = ?');
      while (checkReqCode.get(requestCode)) {
        requestCode = buildRegistrationRequestCode();
      }

      const requestId = db.transaction(() => {
        const inserted = db
          .prepare(
            `INSERT INTO registration_requests (
               request_code, username, email, full_name, password_hash,
               requested_role_id, requested_role_slug, assigned_class, teacher_slot,
               unit_or_class, identity_number, gender, phone, extra_meta_json,
               has_conflict, conflict_type, conflict_existing_value, conflict_existing_user_id,
               conflict_summary, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
          )
          .run(
            requestCode,
            cleanUsername,
            cleanEmail,
            cleanFullName,
            passwordHash,
            roleRow.id,
            roleRow.slug,
            roleFields.normalizedClass,
            classConflict.slot || '',
            roleFields.normalizedUnitOrClass,
            roleFields.normalizedIdentity,
            roleFields.normalizedGender,
            roleFields.normalizedPhone,
            JSON.stringify(roleFields.normalizedExtraMeta),
            effectiveConflict.hasConflict ? 1 : 0,
            effectiveConflict.conflictType || '',
            effectiveConflict.existingValue || '',
            effectiveConflict.existingHolderUserId,
            effectiveConflict.summary || ''
          );

        const reqId = Number(inserted.lastInsertRowid);
        const notifTitle = classConflict.hasConflict
          ? `Konflik Data ${roleRow.name} (${roleFields.normalizedClass})`
          : `Persetujuan Akun Baru: ${roleRow.name}`;
        const notifMsg = classConflict.hasConflict
          ? `${cleanFullName} mendaftar sebagai ${roleRow.name} untuk ${roleFields.normalizedClass}, namun saat ini sudah terdaftar "${classConflict.existingValue}". Tinjau dan pilih data yang akan diterapkan.`
          : `${cleanFullName} (@${cleanUsername}) mengajukan akun sebagai ${roleRow.name} (${requestCode}) dan menunggu persetujuan Super Admin / Admin / Kepala Perpustakaan.`;

        db.prepare(
          `INSERT INTO notifications (type, title, message, link)
           VALUES ('warning', ?, ?, '/settings?tab=users')`
        ).run(notifTitle, notifMsg);

        logAudit(db, {
          userId: null,
          userName: cleanFullName,
          action: classConflict.hasConflict ? 'AUTH_SIGNUP_CONFLICT_PENDING' : 'AUTH_SIGNUP_PENDING',
          entityType: 'registration_requests',
          entityId: String(reqId),
          ipAddress: ip,
          after: {
            requestCode,
            username: cleanUsername,
            email: cleanEmail,
            roleSlug: roleRow.slug,
            assignedClass: roleFields.normalizedClass,
            hasConflict: effectiveConflict.hasConflict,
            conflictType: effectiveConflict.conflictType,
            existingValue: effectiveConflict.existingValue,
          },
        });

        return reqId;
      })();

      return NextResponse.json(
        {
          ok: true,
          pendingApproval: true,
          status: 'pending',
          requestId,
          requestCode,
          hasConflict: effectiveConflict.hasConflict,
          conflictInfo: effectiveConflict.hasConflict
            ? {
                conflictType: effectiveConflict.conflictType,
                assignedClass: roleFields.normalizedClass,
                existingValue: effectiveConflict.existingValue,
                summary: effectiveConflict.summary,
              }
            : null,
          message: classConflict.hasConflict
            ? `Data ${roleRow.name} untuk ${roleFields.normalizedClass} sudah terisi (${classConflict.existingValue}). Pendaftaran Anda (${requestCode}) berstatus Pending dan menunggu persetujuan Super Admin / Admin / Kepala Perpustakaan untuk memutuskan data mana yang diterapkan. Anda dapat menutup browser dengan aman.`
            : `Pendaftaran sebagai "${roleRow.name}" (${requestCode}) berhasil dikirim dengan status Pending. Menunggu persetujuan Super Admin / Admin / Kepala Perpustakaan. Anda dapat menutup browser dengan aman.`,
        },
        { status: 201 }
      );
    }

    // CASE 2: Immediate activation + direct synchronization (no conflict, no approval gate)
    const created = db.transaction(() => {
      let linkedMemberId: number | null = null;
      if (roleRow.slug !== 'pengunjung') {
        linkedMemberId = ensureMemberRecordForUser(db, {
          fullName: cleanFullName,
          email: cleanEmail,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
          unitOrClass: roleFields.normalizedUnitOrClass,
          assignedClass: roleFields.normalizedClass,
          gradeLevel: selectedClassRow?.grade_level ?? null,
          identityNumber: roleFields.normalizedIdentity,
          gender: roleFields.normalizedGender,
          phone: roleFields.normalizedPhone,
          memberSubStatus: roleFields.normalizedExtraMeta.memberSubStatus,
          memberCodePrefix: prefix,
        });
      }

      const userId = Number(
        db
          .prepare(
            `INSERT INTO users (
               username, email, full_name, password_hash, role_id, member_id, assigned_class,
               is_active, approval_status, requested_role_id, approved_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'approved', NULL, datetime('now'))`
          )
          .run(
            cleanUsername,
            cleanEmail,
            cleanFullName,
            passwordHash,
            roleRow.id,
            linkedMemberId,
            roleFields.normalizedClass
          ).lastInsertRowid
      );

      let syncSummary = '';
      if ((roleRow.slug === 'siswa' || roleRow.slug === 'duta_literasi') && roleFields.normalizedClass) {
        const res = syncStudentToClassRoster(db, {
          className: roleFields.normalizedClass,
          fullName: cleanFullName,
          identityNumber: roleFields.normalizedIdentity,
          gender: roleFields.normalizedGender,
        });
        if (res.synced) {
          syncSummary = `Data siswa otomatis tersinkron ke daftar rombel ${roleFields.normalizedClass}.`;
        }
      } else if (
        (roleRow.slug === 'wali_kelas' || roleRow.slug === 'guru_pendamping') &&
        roleFields.normalizedClass &&
        classConflict.slot
      ) {
        const res = syncTeacherToClassAndSchedules(db, {
          className: roleFields.normalizedClass,
          slot: classConflict.slot,
          teacherName: cleanFullName,
          syncSchedules: true,
        });
        if (res.updatedClass) {
          syncSummary = `${roleRow.name} untuk ${roleFields.normalizedClass} langsung tersinkron ke data rombel & ${res.updatedSchedules} jadwal baca.`;
        }
      }

      logAudit(db, {
        userId,
        userName: cleanFullName,
        action: 'AUTH_SIGNUP',
        entityType: 'users',
        entityId: userId,
        ipAddress: ip,
        after: {
          username: cleanUsername,
          email: cleanEmail,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
          assignedClass: roleFields.normalizedClass,
          unitOrClass: roleFields.normalizedUnitOrClass,
          memberId: linkedMemberId,
          syncSummary,
        },
      });

      return { userId, linkedMemberId, syncSummary };
    })();

    const permRows = db
      .prepare(
        `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?`
      )
      .all(roleRow.id) as Array<{ code: string }>;

    const token = signSessionToken({
      userId: created.userId,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const isHttps =
      req.headers.get('x-forwarded-proto')?.includes('https') ||
      req.nextUrl.protocol === 'https:';

    const response = NextResponse.json(
      {
        ok: true,
        pendingApproval: false,
        syncSummary: created.syncSummary,
        token,
        user: {
          id: created.userId,
          username: cleanUsername,
          email: cleanEmail,
          fullName: cleanFullName,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
          assignedClass: roleFields.normalizedClass,
          memberId: created.linkedMemberId,
          permissions: permRows.map((p) => p.code),
        },
      },
      { status: 201 }
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('Signup error:', err);
    return NextResponse.json({ error: 'Gagal memproses pendaftaran akun.' }, { status: 500 });
  }
}
