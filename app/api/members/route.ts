import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { generateNextMemberCode } from '@/lib/db/member-link';
import { formatIsoDate, addDaysIso } from '@/lib/domain/library-rules';
import { compareClassNames } from '@/lib/domain/reading-schedule-rules';

export async function GET(req: NextRequest) {
  const guard = await requirePermission('members.read');
  if (guard.errorResponse) return guard.errorResponse;

  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const status = sp.get('status') || '';
  const typeId = sp.get('typeId') || '';
  const className = (sp.get('className') || '').trim();
  const archivedMode = sp.get('archived') || 'exclude';

  let where =
    archivedMode === 'only'
      ? 'WHERE m.archived_at IS NOT NULL'
      : archivedMode === 'all'
        ? 'WHERE 1=1'
        : 'WHERE m.archived_at IS NULL';
  const params: Array<string | number> = [];

  if (q) {
    const like = `%${q}%`;
    where += ' AND (m.member_code LIKE ? OR m.full_name LIKE ? OR m.email LIKE ? OR m.phone LIKE ? OR m.unit_or_class LIKE ?)';
    params.push(like, like, like, like, like);
  }
  if (status) {
    where += ' AND m.status = ?';
    params.push(status);
  }
  if (typeId) {
    where += ' AND m.membership_type_id = ?';
    params.push(Number(typeId));
  }
  if (className) {
    where += ' AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))';
    params.push(className);
  }

  const members = db
    .prepare(
      `SELECT m.*, mt.name as membership_type_name, mt.max_loans, mt.loan_duration_days, mt.max_renewals,
              (SELECT COUNT(*) FROM loan_items li JOIN loans l ON l.id = li.loan_id
               WHERE l.member_id = m.id AND li.returned_at IS NULL) as active_loans_count,
              (SELECT COALESCE(SUM(f.amount - f.paid_amount - f.waived_amount), 0)
               FROM fines f WHERE f.member_id = m.id AND f.status IN ('Belum Lunas', 'Sebagian')) as unpaid_fines_total
       FROM members m
       JOIN membership_types mt ON mt.id = m.membership_type_id
       ${where}
       ORDER BY m.id DESC`
    )
    .all(...params);

  const membershipTypes = db.prepare('SELECT * FROM membership_types ORDER BY id ASC').all();
  const rawClasses = db
    .prepare(
      `SELECT class_name, grade_level, homeroom_teacher, companion_teacher, room_label
       FROM school_classes
       WHERE archived_at IS NULL
       ORDER BY grade_level ASC, class_name ASC`
    )
    .all() as Array<{
    class_name: string;
    grade_level: number;
    homeroom_teacher: string;
    companion_teacher: string;
    room_label: string;
  }>;
  rawClasses.sort((a, b) => compareClassNames(a.class_name, b.class_name));
  const schoolClasses = rawClasses.map((c) => ({
    className: c.class_name,
    gradeLevel: c.grade_level,
    homeroomTeacher: c.homeroom_teacher,
    companionTeacher: c.companion_teacher,
    roomLabel: c.room_label || '',
  }));

  return NextResponse.json({ members, membershipTypes, schoolClasses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('members.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const fullName = String(body.fullName || '').trim();
    const membershipTypeId = Number(body.membershipTypeId || 1);
    const email = String(body.email || '').trim();
    const phone = String(body.phone || '').trim();

    if (!fullName) {
      return NextResponse.json({ error: 'Nama lengkap anggota wajib diisi.' }, { status: 400 });
    }

    const db = getDb();
    const mTypeExists = db
      .prepare('SELECT id FROM membership_types WHERE id = ?')
      .get(membershipTypeId);
    if (!mTypeExists) {
      return NextResponse.json({ error: 'Jenis keanggotaan tidak valid.' }, { status: 400 });
    }

    const settings = getSettingsMap(db);
    const prefix = settings.member_code_prefix || 'AGT-2026-';
    const today = formatIsoDate(new Date());
    const expiresAt = body.expiresAt ? String(body.expiresAt).trim() : addDaysIso(today, 365);

    const memberCode = body.memberCode
      ? String(body.memberCode).trim()
      : generateNextMemberCode(db, prefix);

    const duplicate = db.prepare('SELECT id FROM members WHERE member_code = ?').get(memberCode);
    if (duplicate) {
      return NextResponse.json(
        { error: `Nomor anggota ${memberCode} sudah digunakan anggota lain.` },
        { status: 409 }
      );
    }

    const memberId = db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO members (member_code, full_name, membership_type_id, identity_number, gender, unit_or_class, address, phone, email, registered_at, expires_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aktif')`
          )
          .run(
            memberCode,
            fullName,
            membershipTypeId,
            String(body.identityNumber || ''),
            String(body.gender || 'Tidak Disebutkan'),
            String(body.unitOrClass || ''),
            String(body.address || ''),
            phone,
            email,
            today,
            expiresAt
          ).lastInsertRowid
      );

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'MEMBER_CREATE',
        entityType: 'members',
        entityId: id,
        after: { memberCode, fullName, membershipTypeId },
      });

      return id;
    })();

    return NextResponse.json({ id: memberId, memberCode }, { status: 201 });
  } catch (err) {
    console.error('Create member error:', err);
    return NextResponse.json({ error: 'Gagal mendaftarkan anggota baru.' }, { status: 500 });
  }
}
