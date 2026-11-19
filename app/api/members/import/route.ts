import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { requirePermission } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';

interface MemberImportRow {
  fullName?: string;
  Nama?: string;
  nama?: string;
  unitOrClass?: string;
  Kelas?: string;
  kelas?: string;
  Unit_Kelas?: string;
  membershipType?: string;
  Jenis?: string;
  jenis?: string;
  identityNumber?: string;
  NIS?: string;
  NISN?: string;
  NIP?: string;
  gender?: string;
  Jenis_Kelamin?: string;
  email?: string;
  Email?: string;
  phone?: string;
  Telepon?: string;
  address?: string;
  Alamat?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('members.write');
  if (guard.errorResponse) return guard.errorResponse;

  try {
    const body = await req.json();
    const mode = body.mode === 'commit' ? 'commit' : 'preview';
    const skipInvalid = Boolean(body.skipInvalid ?? true);
    const rows: MemberImportRow[] = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Tidak ada baris data anggota untuk diproses.' }, { status: 400 });
    }

    const db = getDb();
    const existingIdentities = new Set(
      (
        db
          .prepare("SELECT identity_number FROM members WHERE identity_number IS NOT NULL AND identity_number != ''")
          .all() as Array<{ identity_number: string }>
      ).map((r) => r.identity_number.trim())
    );
    const seenIdentity = new Set<string>();

    const evaluated = rows.map((r, idx) => {
      const fullName = String(r.fullName || r.Nama || r.nama || '').trim();
      const unitOrClass = String(r.unitOrClass || r.Kelas || r.kelas || r.Unit_Kelas || '').trim();
      const typeName = String(r.membershipType || r.Jenis || r.jenis || 'Siswa Kelas 1–3').trim();
      const identityNumber = String(r.identityNumber || r.NIS || r.NISN || r.NIP || '').trim();
      const gender = String(r.gender || r.Jenis_Kelamin || 'Tidak Disebutkan').trim();
      const email = String(r.email || r.Email || '').trim();
      const phone = String(r.phone || r.Telepon || '').trim();
      const address = String(r.address || r.Alamat || '').trim();

      const errors: string[] = [];
      if (!fullName) errors.push('Nama lengkap kosong');
      if (identityNumber && existingIdentities.has(identityNumber)) {
        errors.push(`Duplikat NIS/NIP di database (${identityNumber})`);
      }
      if (identityNumber && seenIdentity.has(identityNumber)) {
        errors.push(`Duplikat NIS/NIP dalam file (${identityNumber})`);
      }
      if (identityNumber) seenIdentity.add(identityNumber);

      return {
        rowNumber: idx + 1,
        fullName,
        unitOrClass,
        typeName,
        identityNumber,
        gender: ['Laki-laki', 'Perempuan', 'Tidak Disebutkan'].includes(gender)
          ? gender
          : 'Tidak Disebutkan',
        email,
        phone,
        address,
        valid: errors.length === 0,
        errors,
      };
    });

    const invalidRows = evaluated.filter((r) => !r.valid);
    if (mode === 'preview') {
      return NextResponse.json({
        total: evaluated.length,
        validCount: evaluated.length - invalidRows.length,
        invalidCount: invalidRows.length,
        rows: evaluated,
      });
    }

    if (invalidRows.length > 0 && !skipInvalid) {
      return NextResponse.json(
        { error: 'Masih ada baris anggota tidak valid atau duplikat.' },
        { status: 400 }
      );
    }

    const toInsert = evaluated.filter((r) => r.valid);
    const settings = getSettingsMap(db);
    const prefix = settings.member_code_prefix || 'AGT-2026-';
    const today = formatIsoDate(new Date());
    const expiresAt = addDaysIso(today, 365);

    const mTypes = db.prepare('SELECT id, name FROM membership_types ORDER BY id ASC').all() as Array<{
      id: number;
      name: string;
    }>;

    const insertedCount = db.transaction(() => {
      let maxId = (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM members').get() as { m: number }).m;
      let count = 0;

      for (const r of toInsert) {
        maxId++;
        const memberCode = `${prefix}${String(maxId).padStart(4, '0')}`;
        const matchedType =
          mTypes.find((mt) => mt.name.toLowerCase().includes(r.typeName.toLowerCase())) || mTypes[0];

        db.prepare(
          `INSERT INTO members (member_code, full_name, membership_type_id, identity_number, gender, unit_or_class, address, phone, email, registered_at, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aktif')`
        ).run(
          memberCode,
          r.fullName,
          matchedType ? matchedType.id : 1,
          r.identityNumber,
          r.gender,
          r.unitOrClass,
          r.address,
          r.phone,
          r.email,
          today,
          expiresAt
        );
        count++;
      }

      logAudit(db, {
        userId: guard.user.id,
        userName: guard.user.fullName,
        action: 'MEMBERS_IMPORT',
        entityType: 'members',
        entityId: 'bulk',
        after: { importedMembers: count },
      });

      return count;
    })();

    return NextResponse.json({ ok: true, importedCount: insertedCount });
  } catch (err) {
    console.error('Import members error:', err);
    return NextResponse.json({ error: 'Gagal memproses import data anggota.' }, { status: 500 });
  }
}
