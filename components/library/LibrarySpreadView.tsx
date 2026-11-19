'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogIn,
  LogOut,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  StatCard,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import {
  CategoryHorizontalChart,
  CirculationBarChart,
} from '@/components/dashboard/DashboardCharts';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';

import { BookCoverThumb } from '@/components/books/BookCoverThumb';

export interface CatalogBook {
  id: number;
  title: string;
  subtitle?: string;
  series_name?: string;
  volume?: string;
  isbn: string;
  edition: string;
  publish_year: number;
  publish_city?: string;
  language: string;
  description: string;
  table_of_contents?: string;
  pages: number;
  dimensions?: string;
  binding_type?: string;
  illustration_notes?: string;
  cover_url: string;
  subcategory: string;
  ddc_code?: string;
  call_number?: string;
  subjects?: string;
  target_grade?: string;
  age_range?: string;
  is_reference_only: number;
  read_in_place_only: number;
  is_featured?: number;
  category_id: number;
  category_name: string;
  publisher_name: string;
  authors: string;
  illustrator?: string;
  editor?: string;
  translator?: string;
  total_copies: number;
  available_copies: number;
  shelf_locations: string;
  borrow_count: number;
}

interface DashboardSnapshot {
  stats: {
    totalTitles: number;
    totalCopies: number;
    availableCopies: number;
    borrowedCopies: number;
    overdueItemsCount: number;
    activeMembers: number;
    todayTransactions: number;
    activeReservations: number;
  };
  popularBooks: Array<{
    id: number;
    title: string;
    isbn: string;
    category_name: string;
    borrow_count: number;
    available_count: number;
  }>;
  categoryStats: Array<{
    category: string;
    titles_count: number;
    loans_count: number;
  }>;
  overdueList: Array<{
    loan_item_id: number;
    loan_number: string;
    due_date: string;
    member_name: string;
    member_code: string;
    book_title: string;
    inventory_code: string;
  }>;
  recentActivity: Array<{
    type: string;
    ref_number: string;
    member_name: string;
    activity_date: string;
    status: string;
    item_count: number;
  }>;
  conditionSummary: Array<{ condition: string; count: number }>;
  circulationTrend: Array<{ date: string; loans: number; returns: number }>;
}

interface ReadingSchedulePreview {
  id: number;
  schedule_code: string;
  class_name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room_area: string;
  reading_mode: string;
  status: string;
}

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAY_LABEL_TO_INDO: Record<string, string> = {
  Min: 'Minggu',
  Sen: 'Senin',
  Sel: 'Selasa',
  Rab: 'Rabu',
  Kam: 'Kamis',
  Jum: 'Jumat',
  Sab: 'Sabtu',
};

function toLocalIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDays(weekOffset: number) {
  const base = new Date();
  const dayOfWeek = base.getDay(); // 0=Sun
  const sunday = new Date(base);
  sunday.setDate(base.getDate() - dayOfWeek + weekOffset * 7);

  return Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + idx);
    return {
      iso: toLocalIso(d),
      label: DAY_LABELS[idx],
      dateNum: d.getDate(),
      isSunday: idx === 0,
      isSaturday: idx === 6,
    };
  });
}

export function LibrarySpreadView({
  includeStaffAnalytics = false,
}: {
  includeStaffAnalytics?: boolean;
}) {
  const { user, library, unreadNotifications, logout, can } = useAuth();
  const { showToast } = useToast();
  const isStaffDashboard = includeStaffAnalytics && Boolean(user && can('dashboard.view'));
  const canReadSchedules = Boolean(user && can('schedules.read'));

  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [newest, setNewest] = useState<CatalogBook[]>([]);
  const [mostBorrowed, setMostBorrowed] = useState<CatalogBook[]>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [dash, setDash] = useState<DashboardSnapshot | null>(null);
  const [classSchedules, setClassSchedules] = useState<ReadingSchedulePreview[]>([]);

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [showAllBooks, setShowAllBooks] = useState(false);
  const [featuredId, setFeaturedId] = useState<number | null>(null);
  const [selectedBook, setSelectedBook] = useState<CatalogBook | null>(null);
  const [reserving, setReserving] = useState(false);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateIso, setSelectedDateIso] = useState(() => toLocalIso(new Date()));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opacDisabled, setOpacDisabled] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (categoryId) sp.set('categoryId', categoryId);
      const res = await gatewayFetch(`/api/catalog?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat katalog.');
      setBooks(data.books || []);
      setCategories(data.categories || []);
      setNewest(data.newest || []);
      setMostBorrowed(data.mostBorrowed || []);
      setOpacDisabled(Boolean(data.opacDisabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat katalog.');
    } finally {
      setLoading(false);
    }
  }, [q, categoryId]);

  useEffect(() => {
    let active = true;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (categoryId) sp.set('categoryId', categoryId);

    gatewayFetch(`/api/catalog?${sp.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat katalog.');
        if (active) {
          setBooks(data.books || []);
          setCategories(data.categories || []);
          setNewest(data.newest || []);
          setMostBorrowed(data.mostBorrowed || []);
          setOpacDisabled(Boolean(data.opacDisabled));
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat katalog.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [q, categoryId, user?.uid, library.enableOpacPublic]);

  useEffect(() => {
    if (!isStaffDashboard) return;
    let active = true;
    gatewayFetch('/api/dashboard', { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setDash(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isStaffDashboard, user?.uid]);

  useEffect(() => {
    if (!canReadSchedules) return;
    let active = true;
    gatewayFetch('/api/reading-schedules', { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.schedules) setClassSchedules(data.schedules);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canReadSchedules, user?.uid]);

  const popularDisplay = useMemo(() => {
    if (q || categoryId || showAllBooks) return books;
    const combined = [...mostBorrowed, ...books];
    const picked: CatalogBook[] = [];
    const seenIds = new Set<number>();
    const seenCovers = new Set<string>();
    for (const b of combined) {
      if (picked.length >= 4) break;
      if (seenIds.has(b.id)) continue;
      if (b.cover_url && !seenCovers.has(b.cover_url)) {
        picked.push(b);
        seenIds.add(b.id);
        seenCovers.add(b.cover_url);
      }
    }
    for (const b of combined) {
      if (picked.length >= 4) break;
      if (!seenIds.has(b.id)) {
        picked.push(b);
        seenIds.add(b.id);
      }
    }
    return picked;
  }, [books, mostBorrowed, q, categoryId, showAllBooks]);

  const featuredBook = useMemo(() => {
    if (featuredId) {
      const match = books.find((b) => b.id === featuredId) || mostBorrowed.find((b) => b.id === featuredId);
      if (match) return match;
    }
    return mostBorrowed[0] || books[0] || null;
  }, [featuredId, books, mostBorrowed]);

  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);
  const selectedDayInfo = weekDays.find((d) => d.iso === selectedDateIso) || weekDays[new Date().getDay()];
  const selectedIndoDay = DAY_LABEL_TO_INDO[selectedDayInfo?.label || ''] || '';
  const selectedDaySchedules = useMemo(
    () => (canReadSchedules ? classSchedules.filter((s) => s.day_of_week === selectedIndoDay) : []),
    [canReadSchedules, classSchedules, selectedIndoDay]
  );

  const firstName = useMemo(() => {
    if (!user?.fullName) return 'Sahabat Pustaka';
    const clean = user.fullName.replace(/\(.*?\)/g, '').trim();
    const parts = clean.split(/\s+/);
    if ((parts[0] === 'Pak' || parts[0] === 'Ibu') && parts[1]) {
      return `${parts[0]} ${parts[1]}`;
    }
    return parts[0] || 'Sahabat';
  }, [user]);

  const userInitials = (user?.fullName || 'SP')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  async function handleReserve(book: CatalogBook) {
    if (!user) {
      showToast('info', 'Masuk diperlukan', 'Silakan masuk sebagai siswa atau guru untuk reservasi.');
      return;
    }
    setReserving(true);
    try {
      const res = await gatewayFetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          memberId: user.memberId || 1,
          notes: 'Pengajuan dari Katalog SD',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengajukan reservasi.');
      showToast(
        'success',
        'Reservasi diajukan',
        `Nomor ${data.reservationNumber} · Antrean ke-${data.queuePosition}`
      );
      setSelectedBook(null);
    } catch (err) {
      showToast('error', 'Reservasi gagal', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setReserving(false);
    }
  }

  // Build series groupings from real categories/books for "Koleksi Terbaru & Seri"
  const seriesGroups = useMemo(() => {
    const source = newest.length > 0 ? newest : books;
    if (source.length === 0) return [];
    const firstPair = source.slice(0, 2);
    const secondPair = source.slice(2, 4);
    const list = [
      {
        id: 'seri-literasi',
        title: 'Seri Cerita Anak & Sains SD Terbaru',
        subtitle: `${source.length} judul pilihan perpustakaan`,
        countLabel: `${source.length} jilid`,
        covers: firstPair.map((b) => b.cover_url),
        categoryId: firstPair[0]?.category_id ? String(firstPair[0].category_id) : '',
      },
    ];
    if (secondPair.length > 0) {
      list.push({
        id: 'seri-tematik',
        title: 'Koleksi Pelajaran & Budaya Nusantara',
        subtitle: `${categories.length} kategori tematik SD`,
        countLabel: `${books.length} judul`,
        covers: secondPair.map((b) => b.cover_url),
        categoryId: secondPair[0]?.category_id ? String(secondPair[0].category_id) : '',
      });
    }
    return list;
  }, [newest, books, categories]);

  const renderReadingContextBlocks = (onAfterAction?: () => void, scopeId = 'aside') => (
    <>
      {/* Featured Book Editorial Details (aligned beside Open Book) */}
      <AnimatePresence mode="wait" initial={false}>
        {featuredBook && (
          <motion.div
            key={featuredBook.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
            className="space-y-2"
          >
            <h2 className="font-serif text-[20px] xl:text-[22px] leading-[1.2] font-medium text-[#1E2433] text-balance">
              {featuredBook.title}
            </h2>
            <p className="text-xs font-medium tabular-nums">
              <span className="text-[#E56B63] font-semibold">{featuredBook.available_copies}</span>
              <span className="text-[#7B7D82]">
                {' '}
                / {featuredBook.total_copies} eksemplar · {featuredBook.pages} hlm
              </span>
            </p>
            <p className="text-xs leading-relaxed text-[#5C5E64] line-clamp-3">
              {featuredBook.description}
            </p>
            <div className="flex items-center justify-between pt-0.5 text-xs gap-2">
              <button
                type="button"
                onClick={() => {
                  onAfterAction?.();
                  setSelectedBook(featuredBook);
                }}
                className="font-medium text-[#E56B63] hover:underline cursor-pointer shrink-0"
              >
                Detail & Pinjam →
              </button>
              <span className="font-medium text-[#3C414E] truncate">
                — {featuredBook.authors || 'Tim Penulis'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule Reading / Jadwal Perpustakaan */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[18px] font-medium text-[#1E2433]">Jadwal Baca</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="Minggu sebelumnya"
              className="rounded-full p-1 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="Minggu berikutnya"
              className="rounded-full p-1 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {weekDays.map((day) => {
            const isActive = day.iso === selectedDateIso;
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setSelectedDateIso(day.iso)}
                className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl py-2 text-xs transition-colors cursor-pointer ${
                  isActive ? '' : 'hover:bg-[#F4F3EE]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId={`calendar-day-active-${scopeId}`}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-2xl bg-[#EFECE3]"
                  />
                )}
                <span
                  className={`relative z-10 text-[11px] ${
                    day.isSunday ? 'text-[#E56B63] font-medium' : 'text-[#8A8B90]'
                  }`}
                >
                  {day.label}
                </span>
                <span className="relative z-10 font-mono text-xs font-semibold text-[#1E2433] tabular-nums">
                  {day.dateNum}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-[#7B7D82]">
          {selectedDayInfo?.isSunday
            ? 'Minggu: Perpustakaan SD tutup — waktunya membaca di rumah.'
            : `${selectedIndoDay || selectedDayInfo?.label}: ${library.operatingHours}`}
        </p>

        {canReadSchedules && !selectedDayInfo?.isSunday && (
          <div className="space-y-1.5 pt-0.5">
            {selectedDaySchedules.slice(0, 3).map((sch) => (
              <Link
                key={sch.id}
                href="/schedules"
                onClick={() => onAfterAction?.()}
                className="flex items-center justify-between gap-2 rounded-xl border border-[#EAE7DF] bg-[#F4F3EE]/80 px-2.5 py-1.5 text-[11px] hover:border-[#222B3A]/40 transition-colors"
              >
                <span className="font-semibold text-[#1E2433] shrink-0">{sch.class_name}</span>
                <span className="truncate text-[#5C5E64]">{sch.room_area}</span>
                <span className="font-mono text-[10px] text-[#E56B63] tabular-nums shrink-0">
                  {sch.start_time}–{sch.end_time}
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-0.5 text-[11px]">
          <Link
            href="/schedules"
            onClick={() => onAfterAction?.()}
            className="inline-flex items-center gap-1 font-medium text-[#E56B63] hover:underline"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>
              {canReadSchedules
                ? `Jadwal Semua Kelas (${selectedDaySchedules.length} sesi ${selectedIndoDay || 'hari ini'}) →`
                : 'Jadwal Baca Semua Kelas (1A–6B) →'}
            </span>
          </Link>
        </div>
      </div>

      {/* Reader Friends / Aktivitas Pembaca */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[18px] font-medium text-[#1E2433]">Aktivitas Pembaca</h2>
          <Link
            href={isStaffDashboard ? '/loans' : '/catalog'}
            onClick={() => onAfterAction?.()}
            aria-label="Lihat aktivitas pembaca"
            className="text-[#7B7D82] hover:text-[#1E2433]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative space-y-3.5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[15px] top-4 bottom-4 border-l border-dashed border-[#DFDCD4]"
          />
          {isStaffDashboard && dash?.recentActivity?.length ? (
            dash.recentActivity.slice(0, 2).map((act, idx) => (
              <div key={`${act.ref_number}-${idx}`} className="relative space-y-1">
                <div className="flex items-center gap-3">
                  <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFECE3] text-xs font-semibold text-[#1E2433] ring-4 ring-[#FAF9F5]">
                    {act.member_name
                      .split(' ')
                      .slice(0, 2)
                      .map((s) => s[0])
                      .join('')}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#1E2433]">
                      {act.member_name}
                    </p>
                    <p className="text-[11px] italic text-[#5C5E64]">
                      {act.type} {act.item_count} eksemplar · {act.ref_number}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 pl-11 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-medium text-[#E56B63]">
                    <Check className="h-3 w-3" />
                    {act.status}
                  </span>
                  <span className="font-mono text-[#8A8B90] tabular-nums">
                    {act.activity_date}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="relative space-y-1">
                <div className="flex items-center gap-3">
                  <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFECE3] text-xs font-semibold text-[#1E2433] ring-4 ring-[#FAF9F5]">
                    5A
                  </span>
                  <p className="text-xs font-semibold text-[#1E2433]">Pojok Literasi Kelas 5A</p>
                </div>
                <p className="pl-11 text-[11px] italic leading-relaxed text-[#5C5E64] line-clamp-2">
                  “Cerita petualangan kancil di hutan sangat seru dibaca bersama teman saat jam istirahat.”
                </p>
                <div className="flex items-center justify-between gap-3 pl-11 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-medium text-[#E56B63] truncate">
                    <Check className="h-3 w-3 shrink-0" />
                    {books[0]?.title || 'Petualangan Kancil'}
                  </span>
                  <span className="shrink-0 text-[#8A8B90]">Hari ini</span>
                </div>
              </div>

              <div className="relative space-y-1">
                <div className="flex items-center gap-3">
                  <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFECE3] text-xs font-semibold text-[#1E2433] ring-4 ring-[#FAF9F5]">
                    4B
                  </span>
                  <p className="text-xs font-semibold text-[#1E2433]">Klub Sains Cilik SD</p>
                </div>
                <p className="pl-11 text-[11px] italic leading-relaxed text-[#5C5E64] line-clamp-2">
                  “Kami baru mencoba eksperimen gunung berapi dan tata surya dari rak sains.”
                </p>
                <div className="flex items-center justify-between gap-3 pl-11 text-[11px]">
                  <span className="inline-flex items-center gap-1 font-medium text-[#E56B63] truncate">
                    <Check className="h-3 w-3 shrink-0" />
                    {books[1]?.title || 'Eksperimen Sains Seru'}
                  </span>
                  <span className="shrink-0 text-[#8A8B90]">Kemarin</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <AppShell
      title="Katalog & Ruang Baca SD"
      immersiveSpread
      drawerExtra={(closeDrawer) => renderReadingContextBlocks(closeDrawer, 'drawer')}
    >
      <div className="flex flex-col">
        {/* Main 1:1 Two-Pane Editorial Spread */}
        <div className="flex flex-col xl:flex-row min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
          {/* LEFT / CENTER STAGE */}
          <div className="flex-1 min-w-0 bg-[#F4F3EE] px-6 py-5 sm:px-10 sm:py-5 flex flex-col justify-between gap-5">
            {/* Top Search Bar (1:1 borderless search bar) */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="relative flex-1 min-w-[240px] max-w-md flex items-center">
                <Search className="pointer-events-none h-4 w-4 text-[#7B7D82] shrink-0" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Cari judul buku, penulis, atau edisi..."
                  aria-label="Cari judul buku, penulis, atau edisi"
                  className="w-full bg-transparent pl-3 pr-2 py-1 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter kategori koleksi"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="rounded-full border border-[#E2DFD7] bg-[#FAF9F5] px-3.5 py-1.5 text-xs text-[#4A4945] focus:border-[#222B3A] focus:outline-none"
                >
                  <option value="">Semua Kategori</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {(q || categoryId || showAllBooks) && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ('');
                      setCategoryId('');
                      setShowAllBooks(false);
                    }}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-[#E56B63] hover:bg-[#EFECE3] cursor-pointer"
                  >
                    Reset
                  </button>
                )}

                {/* Compact account & notification link on lg (1024-1279px) while aside lives in hamburger */}
                <div className="hidden lg:flex xl:hidden items-center gap-2 pl-2 border-l border-[#E2DFD7]">
                  {user ? (
                    <>
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-[#222B3A] text-xs font-semibold text-white"
                        title={`${user.fullName} (${user.roleName})`}
                      >
                        {userInitials}
                      </span>
                      <button
                        type="button"
                        onClick={() => void logout()}
                        aria-label="Keluar dari sistem"
                        title="Keluar"
                        className="rounded-full p-2 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
                      >
                        <LogOut className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#222B3A] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#161D28]"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      <span>Masuk</span>
                    </Link>
                  )}
                  <Link
                    href={user ? '/notifications' : '/login'}
                    aria-label="Notifikasi Perpustakaan"
                    className="relative rounded-full p-2 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]"
                  >
                    <Bell className="h-4 w-4" />
                    {unreadNotifications > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#E56B63]" />
                    )}
                  </Link>
                </div>
              </div>
            </div>

            {/* OPAC Public Disabled Guard for Unauthenticated Guests */}
            {!user && (opacDisabled || library.enableOpacPublic === false) && (
              <section className="my-auto rounded-2xl border border-[#DFDCD4] bg-[#FAF9F5] p-8 text-center max-w-xl mx-auto">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#E56B63]">
                  {library.name}
                </p>
                <h1 className="mt-2 font-serif text-2xl font-medium text-[#1E2433]">
                  Katalog Publik (OPAC) Sedang Dinonaktifkan
                </h1>
                <p className="mt-2 text-sm text-[#5C5E64]">
                  Administrator perpustakaan membatasi akses katalog hanya untuk siswa, guru, dan petugas yang telah masuk ke sistem.
                </p>
                <div className="mt-5 flex justify-center">
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#161D28]"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Masuk Siswa / Petugas
                  </Link>
                </div>
              </section>
            )}

            {/* HERO SPREAD: Greeting + Open Book Centerpiece */}
            {!(!user && (opacDisabled || library.enableOpacPublic === false)) && !q && !categoryId && (
              <section className="grid grid-cols-1 md:grid-cols-12 items-center gap-6 py-1">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: MOTION_DURATION.spread, ease: EASE_EDITORIAL }}
                  className="md:col-span-5 space-y-3"
                >
                  <h1 className="font-serif text-[34px] sm:text-[38px] leading-[1.1] font-medium tracking-tight text-[#1E2433] text-balance">
                    Selamat membaca,
                    <br />
                    {firstName}
                  </h1>
                  <p className="max-w-[285px] text-[13px] leading-relaxed text-[#5C5E64]">
                    {library.tagline || 'Taman Baca & Pusat Literasi Siswa Sekolah Dasar'}. Pilih buku cerita atau pelajaran favoritmu hari ini.
                  </p>
                  <div className="pt-1">
                    <motion.button
                      type="button"
                      whileHover={{ y: -1, scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                      onClick={() => featuredBook && setSelectedBook(featuredBook)}
                      disabled={!featuredBook}
                      className="inline-flex items-center gap-2 rounded-full bg-[#222B3A] px-5 py-2.5 text-xs font-medium text-white hover:bg-[#161D28] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <span>Mulai membaca</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </motion.button>
                  </div>
                </motion.div>

                {/* Tactile Overhead Open Book Centerpiece */}
                <div className="md:col-span-7 flex justify-center md:justify-end">
                  <AnimatePresence mode="wait" initial={false}>
                    {featuredBook ? (
                      <motion.button
                        key={featuredBook.id}
                        type="button"
                        initial={{ opacity: 0, y: 8, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.985 }}
                        transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => setSelectedBook(featuredBook)}
                        aria-label={`Buka pratinjau buku ${featuredBook.title}`}
                        className="group relative w-full max-w-[368px] text-left cursor-pointer focus-visible:outline-none"
                      >
                        {/* Realistic Open Book Spread with subtle hardcover board rim */}
                        <div className="rounded-[7px] bg-[#B8C4BC] p-[4px] shadow-[0_24px_48px_-14px_rgba(30,36,51,0.34)]">
                          <div className="relative grid grid-cols-2 overflow-hidden rounded-[4px] border border-[#D8D4C9] bg-[#FDFCF8]">
                            {/* Left Paper Page (Book Typography) */}
                            <div className="relative flex flex-col justify-between bg-[#FDFCF8] p-4 border-r border-[#E6E2D8] min-h-[192px]">
                              <div>
                                <p className="text-[9px] uppercase tracking-[0.18em] text-[#8A8B90] text-center">
                                  {featuredBook.category_name || 'KOLEKSI SD'}
                                </p>
                                <p className="mt-2 font-serif text-[10px] leading-[1.6] text-[#4A4945] line-clamp-6">
                                  {featuredBook.description}
                                </p>
                              </div>
                              <div className="mt-2.5 flex items-center justify-between text-[9px] font-mono text-[#9A9B9F]">
                                <span>{featuredBook.edition}</span>
                                <span>{featuredBook.pages} hlm</span>
                              </div>
                              {/* Inner spine shadow */}
                              <div className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-black/[0.06] to-transparent" />
                            </div>

                            {/* Right Illustrated Page */}
                            <div className="relative bg-[#EAE6DC] min-h-[192px] overflow-hidden">
                              <BookCoverThumb
                                src={featuredBook.cover_url}
                                title={featuredBook.title}
                                size="md"
                                showFallbackTitle={false}
                                className="h-full w-full"
                              />
                              {/* Inner spine shadow */}
                              <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-black/20 to-transparent" />
                            </div>
                          </div>
                        </div>
                      </motion.button>
                    ) : (
                      <div
                        key="placeholder"
                        className="h-[192px] w-full max-w-[368px] rounded-lg border border-dashed border-[#DFDCD4] bg-[#FAF9F5]"
                      />
                    )}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {/* LOWER SECTION 1: Populer Saat Ini (Popular Now) */}
            {!(!user && (opacDisabled || library.enableOpacPublic === false)) && (
            <section id="paling-populer" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-[20px] font-medium text-[#1E2433]">
                  {q || categoryId
                    ? `Hasil Pencarian (${books.length} judul)`
                    : showAllBooks
                      ? `Semua Koleksi SD (${books.length} judul)`
                      : 'Populer Saat Ini'}
                </h2>
                {!q && !categoryId && books.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllBooks((v) => !v)}
                    aria-label={showAllBooks ? 'Tampilkan 4 buku populer' : 'Lihat semua buku'}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7B7D82] hover:text-[#1E2433] cursor-pointer"
                  >
                    <span>{showAllBooks ? 'Ringkas' : 'Lihat semua'}</span>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                )}
              </div>

              {loading && <LoadingState rows={3} />}
              {error && <ErrorState message={error} onRetry={loadCatalog} />}

              {!loading && !error && popularDisplay.length === 0 && (
                <EmptyState
                  title="Buku tidak ditemukan"
                  description="Tidak ada koleksi SD yang cocok dengan kata kunci atau kategori yang dipilih."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQ('');
                        setCategoryId('');
                      }}
                    >
                      Tampilkan Semua Koleksi
                    </Button>
                  }
                />
              )}

              {!loading && !error && popularDisplay.length > 0 && (
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                  {popularDisplay.map((book, idx) => {
                    const isFeatured = featuredBook?.id === book.id;
                    return (
                      <motion.article
                        key={book.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: MOTION_DURATION.normal,
                          delay: getStaggerDelay(idx, 0.045, 0.24),
                          ease: EASE_EDITORIAL,
                        }}
                        whileHover={{ y: -4 }}
                        className="group flex flex-col"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setFeaturedId(book.id);
                            if (q || categoryId || showAllBooks) setSelectedBook(book);
                          }}
                          className="relative aspect-[2/3] w-full overflow-hidden rounded-[4px] bg-[#E7E4DC] shadow-[0_14px_24px_-10px_rgba(30,36,51,0.34)] cursor-pointer text-left"
                        >
                          <BookCoverThumb
                            src={book.cover_url}
                            title={book.title}
                            size="md"
                            className="h-full w-full"
                            imgClassName="transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                          {isFeatured && (
                            <motion.span
                              layoutId="featured-book-underline"
                              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                              className="absolute inset-x-0 bottom-0 h-1 bg-[#E56B63]"
                            />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setSelectedBook(book)}
                          className="mt-2.5 text-left cursor-pointer"
                        >
                          <h3 className="text-[13px] font-medium leading-snug text-[#1E2433] line-clamp-1 group-hover:text-[#E56B63] transition-colors">
                            {book.title}
                          </h3>
                          <p className="mt-0.5 text-[11px] italic text-[#7B7D82] truncate">
                            {book.authors || 'Tim Penulis SD'} ·{' '}
                            <span className="not-italic font-mono tabular-nums">
                              {book.is_reference_only === 1
                                ? 'Baca di tempat'
                                : `${book.available_copies}/${book.total_copies} eks`}
                            </span>
                          </p>
                        </button>
                      </motion.article>
                    );
                  })}
                </div>
              )}
            </section>
            )}

            {/* LOWER SECTION 2: Koleksi Seri & Terbaru (New Series Collection) */}
            {!(!user && (opacDisabled || library.enableOpacPublic === false)) && !loading && !q && !categoryId && seriesGroups.length > 0 && (
              <section id="koleksi-terbaru" className="space-y-2 pt-0.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-serif text-[20px] font-medium text-[#1E2433]">
                    Koleksi Seri & Terbaru
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowAllBooks(true)}
                    aria-label="Lihat semua seri buku"
                    className="text-[#7B7D82] hover:text-[#1E2433] cursor-pointer"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>

                <div className="divide-y divide-[#E7E4DC]">
                  {seriesGroups.slice(0, 1).map((sg) => (
                    <motion.button
                      key={sg.id}
                      type="button"
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.995 }}
                      transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                      onClick={() => {
                        if (sg.categoryId) setCategoryId(sg.categoryId);
                        else setShowAllBooks(true);
                      }}
                      className="flex w-full items-center justify-between gap-4 py-2 text-left hover:bg-[#EFECE3]/60 rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="relative flex h-11 w-14 shrink-0 items-center">
                          {sg.covers[0] && (
                            <img
                              src={sg.covers[0]}
                              alt={sg.title}
                              referrerPolicy="no-referrer"
                              className="h-11 w-8 rounded-[3px] object-cover shadow-md border border-white"
                            />
                          )}
                          {sg.covers[1] && (
                            <img
                              src={sg.covers[1]}
                              alt={sg.title}
                              referrerPolicy="no-referrer"
                              className="-ml-3 h-10 w-8 rounded-[3px] object-cover shadow-md border border-white"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[#1E2433]">{sg.title}</p>
                          <p className="truncate text-xs italic text-[#7B7D82]">{sg.subtitle}</p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-medium text-[#1E2433] tabular-nums">
                        {sg.countLabel}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* RIGHT CONTEXT PANEL (#FAF9F5 — hidden below xl and hosted in hamburger menu instead) */}
          <aside className="hidden xl:flex xl:w-[392px] shrink-0 border-l border-[#EAE7DF] bg-[#FAF9F5] px-8 py-5 flex-col justify-between gap-4">
            {/* Top Right: User Chip + Bell + Logout */}
            <div className="flex items-center justify-between gap-3">
              {user ? (
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#222B3A] text-xs font-semibold text-white">
                    {userInitials}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#1E2433]">{user.fullName}</p>
                    <p className="truncate text-[11px] text-[#7B7D82]">{user.roleName}</p>
                  </div>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-xs font-medium text-[#1E2433] hover:text-[#E56B63]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EFECE3] text-[#1E2433]">
                    <LogIn className="h-3.5 w-3.5" />
                  </span>
                  <span>Masuk Siswa / Petugas</span>
                </Link>
              )}

              <div className="flex items-center gap-1 shrink-0">
                <Link
                  href={user ? '/notifications' : '/login'}
                  aria-label="Notifikasi Perpustakaan"
                  className="relative rounded-full p-2 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]"
                >
                  <Bell className="h-4 w-4" />
                  {unreadNotifications > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#E56B63]" />
                  )}
                </Link>
                {user && (
                  <button
                    type="button"
                    onClick={() => void logout()}
                    aria-label="Keluar dari sistem"
                    title="Keluar"
                    className="rounded-full p-2 text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#C94A43] cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {renderReadingContextBlocks(undefined, 'aside')}
          </aside>
        </div>

        {/* BELOW-THE-FOLD STAFF OPERATIONAL ANALYTICS (visible to Pustakawan/Kepala/Admin on /) */}
        {isStaffDashboard && dash && (
          <section className="border-t border-[#E7E4DC] bg-[#F4F3EE] px-6 py-8 sm:px-10">
            <div className="mx-auto max-w-[1360px] space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl font-medium text-[#1E2433]">
                    Ringkasan Operasional Perpustakaan SD
                  </h2>
                  <p className="text-xs text-[#5C5E64]">
                    Statistik langsung koleksi, peminjaman siswa/guru, keterlambatan, dan kondisi inventaris.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href="/returns">
                    <Button variant="secondary" size="sm">
                      <Clock className="h-3.5 w-3.5" />
                      Proses Pengembalian
                    </Button>
                  </Link>
                  <Link href="/loans">
                    <Button size="sm">
                      <Plus className="h-3.5 w-3.5" />
                      Peminjaman Baru
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard label="Total Judul Buku" value={dash.stats.totalTitles} />
                <StatCard
                  label="Total Eksemplar"
                  value={dash.stats.totalCopies}
                  hint={`${dash.stats.availableCopies} tersedia`}
                />
                <StatCard
                  label="Sedang Dipinjam"
                  value={dash.stats.borrowedCopies}
                  tone="accent"
                  hint={`${dash.stats.activeReservations} reservasi aktif`}
                />
                <StatCard
                  label="Terlambat Dikembalikan"
                  value={dash.stats.overdueItemsCount}
                  tone={dash.stats.overdueItemsCount > 0 ? 'danger' : 'success'}
                  hint={`${dash.stats.activeMembers} anggota aktif · ${dash.stats.todayTransactions} transaksi hari ini`}
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                        Tren Peminjaman & Pengembalian
                      </h3>
                      <p className="text-xs text-[#7B7D82]">
                        Aktivitas sirkulasi berdasarkan tanggal pencatatan database
                      </p>
                    </div>
                    <Link
                      href="/reports"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#E56B63] hover:underline whitespace-nowrap"
                    >
                      Lihat Laporan
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <CirculationBarChart data={dash.circulationTrend} />
                </div>

                <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5">
                  <div className="mb-4">
                    <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                      Kategori Terpopuler
                    </h3>
                    <p className="text-xs text-[#7B7D82]">Distribusi peminjaman per subjek koleksi SD</p>
                  </div>
                  <CategoryHorizontalChart data={dash.categoryStats} />
                </div>
              </div>

              {dash.overdueList.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
                  <div className="flex items-center justify-between border-b border-[#E7E4DC] px-5 py-4">
                    <div>
                      <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                        Daftar Buku Terlambat
                      </h3>
                      <p className="text-xs text-[#7B7D82]">
                        Eksemplar melewati jatuh tempo yang perlu ditindaklanjuti
                      </p>
                    </div>
                    <Link href="/returns" className="text-xs font-medium text-[#E56B63] hover:underline">
                      Buka Pengembalian →
                    </Link>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-[#7B7D82]">
                        <tr>
                          <th className="px-4 py-2.5">Transaksi</th>
                          <th className="px-4 py-2.5">Anggota</th>
                          <th className="px-4 py-2.5">Judul Buku</th>
                          <th className="px-4 py-2.5 text-right">Jatuh Tempo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE7DF]">
                        {dash.overdueList.map((item) => (
                          <tr key={item.loan_item_id} className="hover:bg-[#F4F3EE]/70">
                            <td className="px-4 py-2.5 font-mono text-xs text-[#5C5E64]">
                              {item.loan_number}
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-[#1E2433]">{item.member_name}</p>
                              <p className="font-mono text-[11px] text-[#7B7D82]">{item.member_code}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="text-[#1E2433]">{item.book_title}</p>
                              <p className="font-mono text-[11px] text-[#7B7D82]">{item.inventory_code}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs font-medium text-[#C94A43] tabular-nums">
                              {item.due_date}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Popular Books, Inventory Condition Summary & Recent Activity */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Buku Paling Sering Dipinjam */}
                <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                      Buku Paling Sering Dipinjam
                    </h3>
                    <Link href="/books" className="text-xs font-medium text-[#E56B63] hover:underline">
                      Koleksi →
                    </Link>
                  </div>
                  <div className="divide-y divide-[#EAE7DF]">
                    {dash.popularBooks.slice(0, 5).map((pb, idx) => (
                      <div key={pb.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#1E2433]">
                            <span className="mr-1.5 font-mono text-[#7B7D82]">#{idx + 1}</span>
                            {pb.title}
                          </p>
                          <p className="truncate text-[11px] text-[#7B7D82]">{pb.category_name}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono tabular-nums">
                          <p className="font-semibold text-[#E56B63]">{pb.borrow_count}× pinjam</p>
                          <p className="text-[11px] text-[#7B7D82]">{pb.available_count} tersedia</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Ringkasan Kondisi Inventaris */}
                <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                      Ringkasan Kondisi Inventaris
                    </h3>
                    <Link href="/inventory" className="text-xs font-medium text-[#E56B63] hover:underline">
                      Inventaris →
                    </Link>
                  </div>
                  <div className="space-y-3 pt-1">
                    {['Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang'].map((cond) => {
                      const entry = dash.conditionSummary.find((c) => c.condition === cond);
                      const count = entry?.count || 0;
                      const pct =
                        dash.stats.totalCopies > 0
                          ? Math.round((count / dash.stats.totalCopies) * 100)
                          : 0;
                      const barColor =
                        cond === 'Baik'
                          ? 'bg-emerald-600'
                          : cond === 'Rusak Ringan'
                            ? 'bg-amber-500'
                            : 'bg-[#C94A43]';
                      return (
                        <div key={cond} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-[#1E2433]">{cond}</span>
                            <span className="font-mono text-[#5C5E64] tabular-nums">
                              {count} eks ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE3]">
                            <motion.div
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ duration: MOTION_DURATION.spread, ease: EASE_EDITORIAL }}
                              className={`h-full rounded-full origin-left ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Aktivitas Transaksi Terbaru */}
                <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-base font-semibold text-[#1E2433]">
                      Aktivitas Transaksi Terbaru
                    </h3>
                    <Link href="/loans" className="text-xs font-medium text-[#E56B63] hover:underline">
                      Sirkulasi →
                    </Link>
                  </div>
                  <div className="divide-y divide-[#EAE7DF]">
                    {dash.recentActivity.slice(0, 5).map((act, idx) => (
                      <div key={`${act.ref_number}-${idx}`} className="flex items-center justify-between gap-2 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#1E2433]">{act.member_name}</p>
                          <p className="font-mono text-[11px] text-[#7B7D82]">
                            {act.type} · {act.ref_number}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusIndicator status={act.status} />
                          <p className="mt-0.5 font-mono text-[11px] text-[#7B7D82] tabular-nums">
                            {act.activity_date}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Book Detail & Reservation Modal */}
      <Modal
        open={Boolean(selectedBook)}
        onClose={() => setSelectedBook(null)}
        title={selectedBook?.title || 'Detail Koleksi'}
        description={
          selectedBook
            ? `${selectedBook.subtitle ? `${selectedBook.subtitle} · ` : ''}${selectedBook.authors}${selectedBook.publisher_name ? ` · ${selectedBook.publisher_name}` : ''}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {selectedBook && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <BookCoverThumb
                src={selectedBook.cover_url}
                title={selectedBook.title}
                size="lg"
                className="aspect-[2/3] w-full rounded-lg border border-[#E2DFD7]"
              />

              <div className="space-y-3 sm:col-span-2">
                {(selectedBook.series_name || selectedBook.target_grade) && (
                  <p className="text-xs font-medium text-[#E56B63]">
                    {[
                      selectedBook.series_name
                        ? `${selectedBook.series_name}${selectedBook.volume ? ` (${selectedBook.volume})` : ''}`
                        : '',
                      selectedBook.target_grade || '',
                      selectedBook.age_range ? `Usia ${selectedBook.age_range}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                <p className="text-sm leading-relaxed text-[#4A4945]">
                  {selectedBook.description || 'Sinopsis koleksi belum ditambahkan.'}
                </p>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#E7E4DC] pt-3 text-xs">
                  <div>
                    <dt className="text-[#7B7D82]">ISBN</dt>
                    <dd className="font-mono text-[#1E2433]">{selectedBook.isbn || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">DDC / Nomor Panggil</dt>
                    <dd className="font-mono text-[#1E2433]">
                      {selectedBook.call_number || selectedBook.ddc_code || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">Edisi / Tahun</dt>
                    <dd className="text-[#1E2433]">
                      {selectedBook.edition} ({selectedBook.publish_year}
                      {selectedBook.publish_city ? `, ${selectedBook.publish_city}` : ''})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#7B7D82]">Bahasa / Fisik</dt>
                    <dd className="text-[#1E2433] tabular-nums">
                      {selectedBook.language} · {selectedBook.pages} hlm
                      {selectedBook.dimensions ? ` · ${selectedBook.dimensions}` : ''}
                    </dd>
                  </div>
                  {(selectedBook.illustrator || selectedBook.binding_type) && (
                    <>
                      <div>
                        <dt className="text-[#7B7D82]">Ilustrator</dt>
                        <dd className="text-[#1E2433]">{selectedBook.illustrator || '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-[#7B7D82]">Jenis Jilid</dt>
                        <dd className="text-[#1E2433]">{selectedBook.binding_type || '-'}</dd>
                      </div>
                    </>
                  )}
                  <div className="col-span-2">
                    <dt className="text-[#7B7D82]">Ketersediaan</dt>
                    <dd className="font-semibold text-[#1E2433] tabular-nums">
                      {selectedBook.is_reference_only === 1 ? (
                        <StatusIndicator status="Baca di Tempat" />
                      ) : (
                        `${selectedBook.available_copies} dari ${selectedBook.total_copies} eksemplar`
                      )}
                    </dd>
                  </div>
                  {selectedBook.subjects && (
                    <div className="col-span-2">
                      <dt className="text-[#7B7D82]">Subjek</dt>
                      <dd className="text-[#1E2433]">{selectedBook.subjects}</dd>
                    </div>
                  )}
                </dl>

                {selectedBook.table_of_contents && (
                  <div className="rounded-xl border border-[#E7E4DC] bg-white p-3 text-xs">
                    <p className="font-medium text-[#1E2433]">Daftar Isi / Poin Materi</p>
                    <p className="mt-1 whitespace-pre-line text-[#5C5E64]">
                      {selectedBook.table_of_contents}
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-xl border border-[#E2DFD7] bg-[#F4F3EE] p-3 text-xs text-[#4A4945]">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#E56B63]" />
                  <div>
                    <p className="font-medium text-[#1E2433]">Lokasi Rak</p>
                    <p>{selectedBook.shelf_locations || 'Gedung Perpustakaan SD · Rak Koleksi'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E7E4DC] pt-4">
              {selectedBook.is_reference_only === 1 || selectedBook.read_in_place_only === 1 ? (
                <p className="text-xs text-amber-800">
                  Koleksi referensi khusus dibaca di tempat. Tidak tersedia untuk pinjam keluar atau reservasi.
                </p>
              ) : user ? (
                <div className="flex w-full items-center justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSelectedBook(null)}>
                    Tutup
                  </Button>
                  <Button loading={reserving} onClick={() => handleReserve(selectedBook)}>
                    Ajukan Reservasi Buku
                  </Button>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between gap-3">
                  <p className="text-xs text-[#5C5E64]">
                    Masuk sebagai siswa atau guru untuk mengajukan reservasi antrean buku.
                  </p>
                  <Link href="/login">
                    <Button size="sm">Masuk untuk Reservasi</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
