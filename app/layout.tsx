import type { Metadata } from 'next';
import { Lora, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/Providers';
import { getSessionUser } from '@/lib/auth/session';
import { getDb, getSettingsMap } from '@/lib/db';
import { extractLibraryIdentity } from '@/lib/domain/settings-backup-rules';
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

const DEFAULT_DESCRIPTION =
  'Sistem Manajemen Perpustakaan Sekolah Dasar (SD) untuk pengelolaan buku cerita dan pelajaran, keanggotaan siswa & guru, sirkulasi, reservasi, inventaris, dan laporan literasi.';

export async function generateMetadata(): Promise<Metadata> {
  const isFirestoreOnly =
    (process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'firestore';
  let identity = extractLibraryIdentity();
  if (!isFirestoreOnly) {
    try {
      const db = getDb();
      identity = extractLibraryIdentity(getSettingsMap(db));
    } catch {
      // fallback to defaults
    }
  }
  const title = `${identity.name} — Sistem Perpustakaan Sekolah Dasar`;
  const description = identity.tagline ? `${identity.tagline}. ${DEFAULT_DESCRIPTION}` : DEFAULT_DESCRIPTION;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isFirestoreOnly =
    (process.env.NEXT_PUBLIC_DATA_BACKEND || '').trim().toLowerCase() === 'firestore';

  let initialUser: Awaited<ReturnType<typeof getSessionUser>> | undefined = undefined;
  let initialUnreadNotifications = 0;
  let initialLibrary = extractLibraryIdentity();

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

      initialLibrary = extractLibraryIdentity(settings);
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
