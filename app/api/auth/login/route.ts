import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyPassword, signSessionToken } from '@/lib/auth/crypto';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { logAudit } from '@/lib/db/audit';

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const rl = checkRateLimit(`login:${ip}`, 25, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Terlalu banyak percobaan masuk. Coba lagi dalam ${rl.retryAfterSec} detik.` },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const identifier = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!identifier || !password) {
      return NextResponse.json(
        { error: 'Email/username dan kata sandi wajib diisi.' },
        { status: 400 }
      );
    }

    const db = getDb();
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.full_name, u.password_hash, u.is_active, u.approval_status, u.approval_note, u.member_id,
                r.slug as role_slug, r.name as role_name, r.id as role_id
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE lower(u.email) = ? OR lower(u.username) = ?`
      )
      .get(identifier, identifier) as
      | {
          id: number;
          username: string;
          email: string;
          full_name: string;
          password_hash: string;
          is_active: number;
          approval_status: string;
          approval_note: string;
          member_id: number | null;
          role_slug: string;
          role_name: string;
          role_id: number;
        }
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json(
        { error: 'Email/username atau kata sandi tidak valid.' },
        { status: 401 }
      );
    }

    if (user.approval_status === 'pending') {
      return NextResponse.json(
        {
          error: `Akun Anda sedang menunggu persetujuan Super Admin untuk peran "${user.role_name}". Silakan hubungi Super Admin sekolah.`,
        },
        { status: 403 }
      );
    }

    if (user.approval_status === 'rejected') {
      return NextResponse.json(
        {
          error: user.approval_note
            ? `Pendaftaran akun Anda ditolak oleh Super Admin: ${user.approval_note}`
            : 'Pendaftaran akun Anda ditolak oleh Super Admin.',
        },
        { status: 403 }
      );
    }

    if (user.is_active !== 1) {
      return NextResponse.json(
        { error: 'Akun ini sedang dinonaktifkan. Hubungi Super Admin.' },
        { status: 403 }
      );
    }

    const permRows = db
      .prepare(
        `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?`
      )
      .all(user.role_id) as Array<{ code: string }>;

    const token = signSessionToken({
      userId: user.id,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    logAudit(db, {
      userId: user.id,
      userName: user.full_name,
      action: 'AUTH_LOGIN',
      entityType: 'users',
      entityId: user.id,
      ipAddress: ip,
    });

    const isHttps =
      req.headers.get('x-forwarded-proto')?.includes('https') ||
      req.nextUrl.protocol === 'https:';

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        roleSlug: user.role_slug,
        roleName: user.role_name,
        memberId: user.member_id,
        permissions: permRows.map((p) => p.code),
      },
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Gagal memproses login.' }, { status: 500 });
  }
}
