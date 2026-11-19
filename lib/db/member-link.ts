import type Database from 'better-sqlite3';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import { SCHOOL_ROLE_MAP } from '@/lib/domain/settings-backup-rules';

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
    identityNumber?: string;
    memberCodePrefix?: string;
  }
): number | null {
  const roleDef = SCHOOL_ROLE_MAP.get(params.roleSlug);
  // Visitors don't need a borrowing member card; custom roles default to SISWA_TINGGI if non-staff
  if (params.roleSlug === 'pengunjung') return null;

  const existing = db
    .prepare('SELECT id FROM members WHERE lower(email) = ? AND archived_at IS NULL LIMIT 1')
    .get(params.email.trim().toLowerCase()) as { id: number } | undefined;
  if (existing) return existing.id;

  const targetTypeCode = roleDef?.defaultMembershipTypeCode || 'SISWA_TINGGI';
  const mType =
    (db
      .prepare('SELECT id FROM membership_types WHERE code = ? LIMIT 1')
      .get(targetTypeCode) as { id: number } | undefined) ||
    (db.prepare('SELECT id FROM membership_types ORDER BY id ASC LIMIT 1').get() as
      | { id: number }
      | undefined);
  if (!mType) return null;

  const today = formatIsoDate(new Date());
  const expiresAt = addDaysIso(today, 365);
  const memberCode = generateNextMemberCode(db, params.memberCodePrefix || 'AGT-2026-');

  const inserted = db
    .prepare(
      `INSERT INTO members (
         member_code, full_name, membership_type_id, identity_number, gender,
         unit_or_class, email, registered_at, expires_at, status
       ) VALUES (?, ?, ?, ?, 'Tidak Disebutkan', ?, ?, ?, ?, 'Aktif')`
    )
    .run(
      memberCode,
      params.fullName,
      mType.id,
      params.identityNumber || '',
      params.unitOrClass || params.roleName,
      params.email.trim().toLowerCase(),
      today,
      expiresAt
    );

  return Number(inserted.lastInsertRowid);
}
