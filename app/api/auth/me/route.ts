import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getDb, getSettingsMap } from '@/lib/db';

const DEFAULT_LIBRARY = {
  name: 'Perpustakaan SD Lentera Pustaka',
  tagline: 'Taman Baca & Pusat Literasi Siswa Sekolah Dasar',
  operatingHours: 'Senin–Jumat 07:00–14:30 | Sabtu 08:00–12:00',
  address: '',
  phone: '',
  email: '',
};

export async function GET() {
  const isFirestoreOnly =
    (process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'firestore';

  if (isFirestoreOnly) {
    return NextResponse.json({
      user: null,
      unreadNotifications: 0,
      backendMode: 'firestore',
      library: DEFAULT_LIBRARY,
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
      library: {
        name: settings.library_name || DEFAULT_LIBRARY.name,
        tagline: settings.library_tagline || DEFAULT_LIBRARY.tagline,
        operatingHours: settings.operating_hours || DEFAULT_LIBRARY.operatingHours,
        address: settings.library_address || '',
        phone: settings.library_phone || '',
        email: settings.library_email || '',
      },
    });
  } catch {
    return NextResponse.json({
      user: null,
      unreadNotifications: 0,
      backendMode: 'firestore',
      library: DEFAULT_LIBRARY,
    });
  }
}
