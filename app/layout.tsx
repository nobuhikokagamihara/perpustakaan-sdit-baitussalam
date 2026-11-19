import type { Metadata } from 'next';
import { Lora, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { getDb, getSettingsMap } from '@/lib/db';
import './globals.css';

export const dynamic = 'force-dynamic';

const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-lora',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lentera Pustaka — Sistem Perpustakaan Sekolah Dasar',
  description:
    'Sistem Manajemen Perpustakaan Sekolah Dasar (SD) untuk pengelolaan buku cerita dan pelajaran, keanggotaan siswa & guru, sirkulasi, reservasi, inventaris, dan laporan literasi.',
  openGraph: {
    title: 'Lentera Pustaka — Sistem Perpustakaan Sekolah Dasar',
    description:
      'Sistem Manajemen Perpustakaan Sekolah Dasar (SD) untuk pengelolaan buku cerita dan pelajaran, keanggotaan siswa & guru, sirkulasi, reservasi, inventaris, dan laporan literasi.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lentera Pustaka — Sistem Perpustakaan Sekolah Dasar',
    description:
      'Sistem Manajemen Perpustakaan Sekolah Dasar (SD) untuk pengelolaan buku cerita dan pelajaran, keanggotaan siswa & guru, sirkulasi, reservasi, inventaris, dan laporan literasi.',
  },
};

const DEFAULT_LIBRARY_IDENTITY = {
  name: 'Perpustakaan SD Lentera Pustaka',
  tagline: 'Taman Baca & Pusat Literasi Siswa Sekolah Dasar',
  operatingHours: 'Senin–Jumat 07:00–14:30 | Sabtu 08:00–12:00',
  address: '',
  phone: '',
  email: '',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isFirestoreOnly =
    (process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'firestore';

  let initialUser: Awaited<ReturnType<typeof getSessionUser>> | undefined = undefined;
  let initialUnreadNotifications = 0;
  let initialLibrary = { ...DEFAULT_LIBRARY_IDENTITY };

  if (!isFirestoreOnly) {
    try {
      const db = getDb();
      const settings = getSettingsMap(db);
      initialUser = await getSessionUser();

      if (initialUser) {
        const row =
          initialUser.roleSlug === 'anggota'
            ? (db
                .prepare(
                  `SELECT COUNT(*) as c FROM notifications
                   WHERE is_read = 0 AND (user_id = ? OR member_id = ?)`
                )
                .get(initialUser.id, initialUser.memberId || -1) as { c: number })
            : (db
                .prepare(
                  `SELECT COUNT(*) as c FROM notifications
                   WHERE is_read = 0 AND (user_id = ? OR (user_id IS NULL AND member_id IS NULL))`
                )
                .get(initialUser.id) as { c: number });
        initialUnreadNotifications = row.c;
      }

      initialLibrary = {
        name: settings.library_name || DEFAULT_LIBRARY_IDENTITY.name,
        tagline: settings.library_tagline || DEFAULT_LIBRARY_IDENTITY.tagline,
        operatingHours: settings.operating_hours || DEFAULT_LIBRARY_IDENTITY.operatingHours,
        address: settings.library_address || '',
        phone: settings.library_phone || '',
        email: settings.library_email || '',
      };
    } catch {
      // Serverless / read-only filesystem fallback: let client AuthProvider resolve Firebase session
      initialUser = undefined;
    }
  }

  return (
    <html
      lang="id"
      className={`${lora.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-[#F4F3EE] text-[#1E2433] antialiased" suppressHydrationWarning>
        <Providers
          initialUser={initialUser}
          initialLibrary={initialLibrary}
          initialUnreadNotifications={initialUnreadNotifications}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
