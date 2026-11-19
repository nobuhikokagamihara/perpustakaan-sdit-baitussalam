import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSettingsMap } from '@/lib/db';
import { hashPassword, signSessionToken } from '@/lib/auth/crypto';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';
import { ensureMemberRecordForUser } from '@/lib/db/member-link';
import {
  doesRoleRequireApproval,
  validateSignupInput,
} from '@/lib/domain/settings-backup-rules';

export async function GET() {
  try {
    const db = getDb();
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

    return NextResponse.json({
      roles: roles.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        category: r.category || 'Warga Sekolah',
        requiresApproval: doesRoleRequireApproval(r.slug, r.requires_approval),
      })),
    });
  } catch (err) {
    console.error('Load signup roles error:', err);
    return NextResponse.json({ error: 'Gagal memuat daftar peran sekolah.' }, { status: 500 });
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
    const unitOrClass = String(body.unitOrClass || '').trim().slice(0, 100);
    const identityNumber = String(body.identityNumber || '').trim().slice(0, 64);

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
    const passwordHash = hashPassword(String(body.password || ''));

    const existingUser = db
      .prepare('SELECT id, username, email FROM users WHERE lower(email) = ? OR lower(username) = ?')
      .get(cleanEmail, cleanUsername) as
      | { id: number; username: string; email: string }
      | undefined;

    if (existingUser) {
      const conflictField =
        existingUser.email.toLowerCase() === cleanEmail ? 'Email' : 'Username';
      return NextResponse.json(
        { error: `${conflictField} sudah terdaftar. Silakan gunakan akun lain atau masuk.` },
        { status: 409 }
      );
    }

    const requiresApproval = doesRoleRequireApproval(roleRow.slug, roleRow.requires_approval);
    const settings = getSettingsMap(db);
    const prefix = settings.member_code_prefix || 'AGT-2026-';

    const created = db.transaction(() => {
      let linkedMemberId: number | null = null;

      if (!requiresApproval && roleRow.slug !== 'pengunjung') {
        linkedMemberId = ensureMemberRecordForUser(db, {
          fullName: cleanFullName,
          email: cleanEmail,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
          unitOrClass,
          identityNumber,
          memberCodePrefix: prefix,
        });
      }

      const approvalStatus = requiresApproval ? 'pending' : 'approved';
      const isActive = requiresApproval ? 0 : 1;
      const requestedRoleId = requiresApproval ? roleRow.id : null;

      const userId = Number(
        db
          .prepare(
            `INSERT INTO users (
               username, email, full_name, password_hash, role_id, member_id, is_active,
               approval_status, requested_role_id, approved_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            cleanUsername,
            cleanEmail,
            cleanFullName,
            passwordHash,
            roleRow.id,
            linkedMemberId,
            isActive,
            approvalStatus,
            requestedRoleId,
            requiresApproval ? null : new Date().toISOString().replace('T', ' ').slice(0, 19)
          ).lastInsertRowid
      );

      if (requiresApproval) {
        db.prepare(
          `INSERT INTO notifications (type, title, message, link)
           VALUES ('warning', 'Persetujuan Akun Baru', ?, '/settings')`
        ).run(
          `${cleanFullName} (@${cleanUsername}) mendaftar sebagai ${roleRow.name} dan menunggu persetujuan Super Admin.`
        );
      }

      logAudit(db, {
        userId,
        userName: cleanFullName,
        action: requiresApproval ? 'AUTH_SIGNUP_PENDING' : 'AUTH_SIGNUP',
        entityType: 'users',
        entityId: userId,
        ipAddress: ip,
        after: {
          username: cleanUsername,
          email: cleanEmail,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
          approvalStatus,
          memberId: linkedMemberId,
        },
      });

      return { userId, linkedMemberId };
    })();

    if (requiresApproval) {
      return NextResponse.json(
        {
          ok: true,
          pendingApproval: true,
          message: `Pendaftaran sebagai "${roleRow.name}" berhasil dikirim. Akun Anda menunggu persetujuan Super Admin sebelum dapat digunakan untuk masuk.`,
          user: {
            id: created.userId,
            username: cleanUsername,
            email: cleanEmail,
            fullName: cleanFullName,
            roleSlug: roleRow.slug,
            roleName: roleRow.name,
            approvalStatus: 'pending',
          },
        },
        { status: 201 }
      );
    }

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
        token,
        user: {
          id: created.userId,
          username: cleanUsername,
          email: cleanEmail,
          fullName: cleanFullName,
          roleSlug: roleRow.slug,
          roleName: roleRow.name,
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
