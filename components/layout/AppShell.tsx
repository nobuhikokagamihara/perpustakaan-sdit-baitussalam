'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  Bookmark,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Clock,
  Home,
  LayoutDashboard,
  Lock,
  LogIn,
  LogOut,
  Menu,
  PackagePlus,
  Receipt,
  Settings,
  ShieldAlert,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { useAuth } from '@/components/ui/AuthProvider';
import { LoadingState } from '@/components/ui/DesignPrimitives';
import { buildLoginHref, getDefaultRouteForRole } from '@/lib/auth/redirect';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  publicVisible?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Beranda & Ringkasan', icon: LayoutDashboard, permission: 'dashboard.view' },
  { href: '/catalog', label: 'Katalog Buku (OPAC)', icon: BookOpen, publicVisible: true },
  { href: '/books', label: 'Data Buku', icon: BookMarked, permission: 'books.write' },
  { href: '/members', label: 'Data Anggota', icon: Users, permission: 'members.read' },
  { href: '/loans', label: 'Peminjaman', icon: ArrowLeftRight, permission: 'loans.read' },
  { href: '/returns', label: 'Pengembalian', icon: CheckSquare, permission: 'returns.write' },
  { href: '/reservations', label: 'Reservasi', icon: CalendarClock, permission: 'reservations.read' },
  { href: '/schedules', label: 'Jadwal Baca Kelas', icon: CalendarDays, permission: 'schedules.read' },
  { href: '/fines', label: 'Denda & Pembayaran', icon: Receipt, permission: 'fines.read' },
  { href: '/inventory', label: 'Inventaris & Rak', icon: Warehouse, permission: 'inventory.read' },
  { href: '/acquisitions', label: 'Pengadaan Buku', icon: PackagePlus, permission: 'acquisitions.read' },
  { href: '/reports', label: 'Laporan Analitik', icon: BarChart3, permission: 'reports.read' },
  { href: '/notifications', label: 'Notifikasi', icon: Bell, permission: 'notifications.read' },
  { href: '/settings', label: 'Pengaturan', icon: Settings, permission: 'settings.read' },
];

export function AppShell({
  title,
  description,
  actions,
  immersiveSpread = false,
  requireAuth = false,
  requiredPermission,
  drawerExtra,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  immersiveSpread?: boolean;
  requireAuth?: boolean;
  requiredPermission?: string;
  drawerExtra?: React.ReactNode | ((closeDrawer: () => void) => React.ReactNode);
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user, loading: authLoading, library, unreadNotifications, logout, can } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const needsAuthGate = (requireAuth || Boolean(requiredPermission)) && !authLoading && !user;
  const needsPermissionGate =
    Boolean(requiredPermission) && !authLoading && Boolean(user) && !can(requiredPermission!);
  const isCheckingAuth = (requireAuth || Boolean(requiredPermission)) && authLoading;

  const visibleNav = NAV_ITEMS.filter((item) => {
    if (item.publicVisible) return true;
    if (!user) return false;
    if (item.permission) return can(item.permission);
    return true;
  });

  // 5 primary icon rail actions matching the clean vertical icon rail in the reference
  const railItems = [
    {
      href: '/',
      label: 'Beranda',
      icon: Home,
      active: pathname === '/' || pathname === '/catalog',
    },
    {
      href: user && can('books.write') ? '/books' : '/catalog',
      label: user && can('books.write') ? 'Data Buku' : 'Koleksi Buku',
      icon: BookOpen,
      active: pathname.startsWith('/books'),
    },
    {
      href: user && can('loans.read') ? '/loans' : '/login',
      label: user && can('loans.read') ? 'Sirkulasi Pinjam' : 'Masuk Sirkulasi',
      icon: Clock,
      active: pathname.startsWith('/loans') || pathname.startsWith('/returns'),
    },
    {
      href: user && can('reservations.read') ? '/reservations' : '/login',
      label: user && can('reservations.read') ? 'Reservasi' : 'Reservasi Buku',
      icon: Bookmark,
      active: pathname.startsWith('/reservations'),
    },
    {
      href: user && can('settings.read') ? '/settings' : user && can('inventory.read') ? '/inventory' : '/login',
      label: user && can('settings.read') ? 'Pengaturan' : user && can('inventory.read') ? 'Inventaris' : 'Masuk Sistem',
      icon: Settings,
      active: pathname.startsWith('/settings') || pathname.startsWith('/inventory'),
    },
  ];

  const initials = (user?.fullName || 'LP')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex min-h-screen bg-[#F4F3EE] text-[#1E2433]">
      {/* Desktop Narrow Icon Rail (1:1 with reference left rail) */}
      <aside
        aria-label="Navigasi Ikon"
        className="no-print hidden lg:flex lg:w-[74px] lg:shrink-0 lg:flex-col items-center justify-between border-r border-[#E7E4DC] bg-[#F7F6F1] pt-6 pb-16 sticky top-0 h-screen"
      >
        {/* Top Brand Mark */}
        <Link
          href="/"
          title={library.name}
          aria-label={`Beranda ${library.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[#1E2433] hover:bg-[#EFECE3] transition-colors"
        >
          <BookOpen className="h-5 w-5 stroke-[2]" />
        </Link>

        {/* Center 5-Icon Stack with Coral Active Circle */}
        <nav aria-label="Menu Cepat" className="flex flex-col items-center gap-4">
          {railItems.map((item) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                whileHover={{ scale: 1.07 }}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
              >
                <Link
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    'relative flex h-11 w-11 items-center justify-center rounded-full transition-colors',
                    item.active
                      ? 'text-white'
                      : 'text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]'
                  )}
                >
                  {item.active && (
                    <motion.span
                      layoutId="app-rail-active"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#E56B63] shadow-[0_8px_18px_-4px_rgba(229,107,99,0.55)]"
                    />
                  )}
                  <Icon className="relative z-10 h-[19px] w-[19px]" />
                </Link>
              </motion.div>
            );
          })}
        </nav>

        {/* Bottom Circular Drawer Button */}
        <motion.button
          type="button"
          onClick={() => setDrawerOpen(true)}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
          title="Buka Semua Menu Perpustakaan"
          aria-label="Buka semua menu perpustakaan"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[#DFDCD4] bg-white text-[#1E2433] hover:bg-[#EFECE3] transition-colors cursor-pointer"
        >
          <Menu className="h-4 w-4" />
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#E56B63] ring-2 ring-[#F7F6F1]" />
          )}
        </motion.button>
      </aside>

      {/* Slide-over Full Navigation Drawer (Desktop & Mobile) */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="no-print fixed inset-0 z-50 flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE_EDITORIAL }}
              className="fixed inset-0 bg-[#1E2433]/35 backdrop-blur-[1px]"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ duration: MOTION_DURATION.panel, ease: EASE_EDITORIAL }}
              className="relative z-10 flex w-[300px] sm:w-80 flex-col bg-[#FAF9F5] border-r border-[#E7E4DC] shadow-2xl"
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#E7E4DC] px-5">
                <div className="min-w-0 pr-2">
                  <p className="truncate font-serif text-base font-semibold text-[#1E2433]">{library.name}</p>
                  <p className="truncate text-[11px] text-[#7B7D82]">
                    {library.academicYear
                      ? `TA ${library.academicYear} · Semester ${library.semester || 'Ganjil'}`
                      : library.tagline}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Tutup menu"
                  className="rounded-full p-1.5 text-[#7B7D82] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <nav aria-label="Menu Lengkap" className="space-y-1 px-3 py-4">
                  {visibleNav.map((item, idx) => {
                    const Icon = item.icon;
                    const active =
                      item.href === '/'
                        ? pathname === '/'
                        : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <motion.div
                        key={item.href}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: MOTION_DURATION.normal,
                          delay: getStaggerDelay(idx, 0.02, 0.2),
                          ease: EASE_EDITORIAL,
                        }}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setDrawerOpen(false)}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                            active
                              ? 'bg-[#E56B63] text-white'
                              : 'text-[#4A4945] hover:bg-[#EFECE3] hover:text-[#1E2433]'
                          )}
                        >
                          <span className="flex items-center gap-2.5 truncate">
                            <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-white' : 'text-[#7B7D82]')} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.href === '/notifications' && unreadNotifications > 0 && (
                            <span
                              className={cn(
                                'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                                active ? 'bg-white/25 text-white' : 'bg-[#E56B63] text-white'
                              )}
                            >
                              {unreadNotifications}
                            </span>
                          )}
                        </Link>
                      </motion.div>
                    );
                  })}
                </nav>

                {drawerExtra && (
                  <div className="xl:hidden border-t border-[#E7E4DC] px-4 py-5 space-y-5 bg-[#FAF9F5]">
                    {typeof drawerExtra === 'function'
                      ? drawerExtra(() => setDrawerOpen(false))
                      : drawerExtra}
                  </div>
                )}
              </div>

              <div className="border-t border-[#E7E4DC] p-4">
                {user ? (
                  <>
                    <p className="truncate text-xs font-semibold text-[#1E2433]">{user.fullName}</p>
                    <p className="mt-0.5 truncate text-xs text-[#7B7D82]">
                      {user.roleName} · {library.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-[#E2DFD7] bg-white px-3 py-2 text-xs font-medium text-[#1E2433] hover:bg-[#EFECE3] cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Keluar
                    </button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setDrawerOpen(false)}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-[#222B3A] px-4 py-2 text-xs font-medium text-white hover:bg-[#161D28]"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Masuk Sistem
                  </Link>
                )}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Mobile Top Bar */}
        <header className="no-print flex lg:hidden h-14 items-center justify-between gap-3 border-b border-[#E7E4DC] bg-[#F7F6F1] px-4 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu navigasi"
              className="rounded-full border border-[#DFDCD4] bg-white p-2 text-[#1E2433]"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Link href="/" className="font-serif text-base font-semibold text-[#1E2433] truncate">
              {library.name}
            </Link>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {user ? (
              <>
                <Link
                  href="/notifications"
                  aria-label="Notifikasi"
                  className="relative rounded-full border border-[#DFDCD4] bg-white p-2 text-[#1E2433]"
                >
                  <Bell className="h-4 w-4" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#E56B63]" />
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  aria-label="Keluar dari sistem"
                  title="Keluar"
                  className="rounded-full border border-[#DFDCD4] bg-white p-2 text-[#1E2433] hover:bg-[#EFECE3] cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : (
              <Link
                href={buildLoginHref(pathname)}
                className="rounded-full bg-[#222B3A] px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap"
              >
                Masuk
              </Link>
            )}
          </div>
        </header>

        {immersiveSpread ? (
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
            className="flex-1 min-w-0"
          >
            {children}
          </motion.main>
        ) : (
          <>
            {/* Editorial Top Bar for Operational Subpages */}
            <header className="no-print hidden lg:flex h-16 items-center justify-between gap-6 border-b border-[#E7E4DC] bg-[#FAF9F5] px-8">
              <div className="min-w-0">
                <p className="truncate text-xs text-[#7B7D82]">
                  {library.name}
                  {library.academicYear ? ` · TA ${library.academicYear} (${library.semester || 'Ganjil'})` : ''}
                </p>
                <p className="truncate font-serif text-base font-medium text-[#1E2433]">{title}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {user ? (
                  <>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#222B3A] text-xs font-semibold text-white">
                        {initials}
                      </span>
                      <div className="text-left">
                        <p className="text-xs font-medium text-[#1E2433]">{user.fullName}</p>
                        <p className="text-[11px] text-[#7B7D82]">{user.roleName}</p>
                      </div>
                    </div>
                    <Link
                      href="/notifications"
                      aria-label="Notifikasi"
                      className="relative rounded-full p-2 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]"
                    >
                      <Bell className="h-4 w-4" />
                      {unreadNotifications > 0 && (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#E56B63]" />
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void logout()}
                      aria-label="Keluar dari sistem"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DFD7] bg-white px-3 py-1.5 text-xs font-medium text-[#1E2433] hover:bg-[#EFECE3] transition-colors cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Keluar</span>
                    </button>
                  </>
                ) : (
                  <Link
                    href={buildLoginHref(pathname)}
                    className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-4 py-2 text-xs font-medium text-white hover:bg-[#161D28]"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Masuk Sistem
                  </Link>
                )}
              </div>
            </header>

            <main className="flex-1 p-5 lg:p-8">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
                className="mx-auto max-w-[1400px]"
              >
                <div className="no-print mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="font-serif text-2xl font-medium tracking-tight text-[#1E2433] lg:text-3xl">
                      {title}
                    </h1>
                    {description && <p className="mt-1 text-sm text-[#5C5E64]">{description}</p>}
                  </div>
                  {actions && !needsAuthGate && !needsPermissionGate && (
                    <div className="flex flex-wrap items-center gap-2">{actions}</div>
                  )}
                </div>
                {isCheckingAuth ? (
                  <LoadingState rows={5} />
                ) : needsAuthGate ? (
                  <div className="rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8 text-center max-w-lg mx-auto my-8">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#EFECE3] text-[#1E2433]">
                      <Lock className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-serif text-xl font-medium text-[#1E2433]">
                      Masuk Sistem Diperlukan
                    </h2>
                    <p className="mt-2 text-sm text-[#5C5E64]">
                      Halaman ini hanya tersedia untuk pengguna perpustakaan yang telah masuk. Silakan masuk terlebih dahulu untuk melanjutkan.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <Link
                        href={buildLoginHref(pathname)}
                        className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#161D28]"
                      >
                        <LogIn className="h-4 w-4" />
                        Masuk Sistem
                      </Link>
                      <Link
                        href="/catalog"
                        className="inline-flex items-center gap-2 rounded-full border border-[#E2DFD7] bg-white px-5 py-2.5 text-sm font-medium text-[#1E2433] hover:bg-[#EFECE3]"
                      >
                        Kembali ke Katalog OPAC
                      </Link>
                    </div>
                  </div>
                ) : needsPermissionGate ? (
                  <div className="rounded-2xl border border-[#F2C6C3] bg-[#FAF9F5] p-8 text-center max-w-lg mx-auto my-8">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FDF2F1] text-[#C94A43]">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-serif text-xl font-medium text-[#1E2433]">
                      Akses Peran Dibatasi
                    </h2>
                    <p className="mt-2 text-sm text-[#5C5E64]">
                      Akun Anda masuk sebagai <strong className="text-[#1E2433]">{user?.roleName}</strong> dan tidak memiliki izin akses untuk modul ini (<span className="font-mono text-xs">{requiredPermission}</span>).
                    </p>
                    <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                      <Link
                        href={getDefaultRouteForRole(user?.roleSlug || 'anggota')}
                        className="inline-flex items-center gap-2 rounded-full border border-[#E2DFD7] bg-white px-5 py-2.5 text-sm font-medium text-[#1E2433] hover:bg-[#EFECE3]"
                      >
                        Kembali ke Beranda
                      </Link>
                      <button
                        type="button"
                        onClick={() => void logout('/login')}
                        className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#161D28] cursor-pointer"
                      >
                        <LogOut className="h-4 w-4" />
                        Ganti Akun
                      </button>
                    </div>
                  </div>
                ) : (
                  children
                )}
              </motion.div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}
