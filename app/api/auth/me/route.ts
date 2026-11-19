import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getDb, getSettingsMap } from '@/lib/db';
import { extractLibraryIdentity } from '@/lib/domain/settings-backup-rules';

export async function GET() {
  const isFirestoreOnly =
    (process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'firestore';

  if (isFirestoreOnly) {
    return NextResponse.json({
      user: null,
      unreadNotifications: 0,
      backendMode: 'firestore',
      library: extractLibraryIdentity(),
    });
  }

  try {
    const db = getDb();
    const settings = getSettingsMap(db);
    const user = await getSessionUser();

    let unreadNotifications = 0;
    if (user) {
      const row =
        user.roleSlug === 'anggota'
          ? (db
              .prepare(
                `SELECT COUNT(*) as c FROM notifications
                 WHERE is_read = 0 AND (user_id = ? OR member_id = ?)`
              )
              .get(user.id, user.memberId || -1) as { c: number })
          : (db
              .prepare(
                `SELECT COUNT(*) as c FROM notifications
                 WHERE is_read = 0 AND (user_id = ? OR (user_id IS NULL AND member_id IS NULL))`
              )
              .get(user.id) as { c: number });
      unreadNotifications = row.c;
    }

    return NextResponse.json({
      user,
      unreadNotifications,
      backendMode: 'hybrid',
      library: extractLibraryIdentity(settings),
    });
  } catch {
    return NextResponse.json({
      user: null,
      unreadNotifications: 0,
      backendMode: 'firestore',
      library: extractLibraryIdentity(),
    });
  }
}
