import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifySessionToken } from './crypto';
import { hasPermission } from '@/lib/domain/library-rules';

export const SESSION_COOKIE_NAME = 'lentera_session';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  roleSlug: string;
  roleName: string;
  memberId: number | null;
  permissions: string[];
}

export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    let payload = cookieToken ? verifySessionToken(cookieToken) : null;

    if (!payload) {
      const headerStore = await headers();
      const authHeader = headerStore.get('authorization') || '';
      if (authHeader.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        if (bearerToken) {
          payload = verifySessionToken(bearerToken);
        }
      }
    }

    if (!payload) return null;

    const db = getDb();
    const userRow = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.full_name, u.member_id, u.is_active, u.approval_status,
                r.id as role_id, r.slug as role_slug, r.name as role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ?`
      )
      .get(payload.userId) as
      | {
          id: number;
          username: string;
          email: string;
          full_name: string;
          member_id: number | null;
          is_active: number;
          approval_status: string;
          role_id: number;
          role_slug: string;
          role_name: string;
        }
      | undefined;

    if (!userRow || userRow.is_active !== 1 || userRow.approval_status !== 'approved') return null;

    const permRows = db
      .prepare(
        `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ?`
      )
      .all(userRow.role_id) as Array<{ code: string }>;

    return {
      id: userRow.id,
      username: userRow.username,
      email: userRow.email,
      fullName: userRow.full_name,
      roleSlug: userRow.role_slug,
      roleName: userRow.role_name,
      memberId: userRow.member_id,
      permissions: permRows.map((p) => p.code),
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<
  { user: AuthUser; errorResponse?: never } | { user?: never; errorResponse: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Autentikasi diperlukan. Silakan masuk terlebih dahulu.' },
        { status: 401 }
      ),
    };
  }
  return { user };
}

export async function requirePermission(
  permission: string
): Promise<
  { user: AuthUser; errorResponse?: never } | { user?: never; errorResponse: NextResponse }
> {
  const auth = await requireAuth();
  if (auth.errorResponse) return auth;
  if (!hasPermission(auth.user.permissions, permission)) {
    return {
      errorResponse: NextResponse.json(
        { error: `Akses ditolak. Izin '${permission}' diperlukan untuk tindakan ini.` },
        { status: 403 }
      ),
    };
  }
  return { user: auth.user };
}
