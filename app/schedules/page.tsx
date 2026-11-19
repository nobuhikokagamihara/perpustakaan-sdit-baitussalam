'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Download,
  Edit3,
  GraduationCap,
  MapPin,
  Plus,
  Printer,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { AttendanceRecapPanel } from '@/components/schedules/AttendanceRecapPanel';
import { ClassAttendanceBarChart } from '@/components/schedules/ClassAttendanceBarChart';
import { ClassRosterPanel } from '@/components/schedules/ClassRosterPanel';
import { SessionAttendanceModal } from '@/components/schedules/SessionAttendanceModal';
import type {
  BookOption,
  LiveClassPreset,
  ScheduleLogRow,
  ScheduleRow,
} from '@/components/schedules/types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  SearchField,
  SelectField,
  StatCard,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { exportToCsv, exportToExcel, exportToPdf } from '@/lib/client/export';
import {
  READING_AREAS,
  READING_DAYS,
  READING_MODES,
  SD_CLASSES,
  detectScheduleConflict,
  type ClassCoverageSummary,
  type ReadingScheduleRecord,
  type ScheduleSummary,
} from '@/lib/domain/reading-schedule-rules';
import { cn } from '@/lib/utils';

type ViewTab = 'weekly' | 'table' | 'rosters' | 'recap';

const EMPTY_COVERAGE: ClassCoverageSummary = {
  totalClasses: SD_CLASSES.length,
  coveredCount: 0,
  missingClasses: SD_CLASSES.map((c) => c.className),
  coveragePercent: 0,
  classBreakdown: SD_CLASSES.map((c) => ({
    className: c.className,
    gradeLevel: c.gradeLevel,
    homeroomTeacher: c.homeroomTeacher,
    companionTeacher: c.companionTeacher,
    defaultStudentCount: c.studentCount,
    sessionCount: 0,
    completedCount: 0,
    totalMinutes: 0,
    hasSchedule: false,
  })),
};

const EMPTY_SUMMARY: ScheduleSummary = {
  totalSessions: 0,
  activeSessions: 0,
  completedSessions: 0,
  totalScheduledStudents: 0,
  totalStudentsPresent: 0,
  totalBooksRead: 0,
};

function toDomainRow(row: ScheduleRow): ReadingScheduleRecord {
  return {
    id: row.id,
    scheduleCode: row.schedule_code,
    className: row.class_name,
    gradeLevel: row.grade_level,
    homeroomTeacher: row.homeroom_teacher,
    companionTeacher: row.companion_teacher,
    studentCount: row.student_count,
    dayOfWeek: row.day_of_week,
    scheduleDate: row.schedule_date,
    startTime: row.start_time,
    endTime: row.end_time,
    roomArea: row.room_area,
    readingMode: row.reading_mode,
    readingTheme: row.reading_theme,
    bookId: row.book_id,
    bookTitle: row.book_title || '',
    status: row.status,
    studentsPresent: row.students_present,
    booksReadCount: row.books_read_count,
    sessionNotes: row.session_notes,
  };
}

export default function ReadingSchedulesPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canRead = can('schedules.read');
  const canWrite = can('schedules.write');

  const [allSchedules, setAllSchedules] = useState<ScheduleRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [logs, setLogs] = useState<ScheduleLogRow[]>([]);
  const [liveClasses, setLiveClasses] = useState<LiveClassPreset[]>([...SD_CLASSES]);
  const [coverage, setCoverage] = useState<ClassCoverageSummary>(EMPTY_COVERAGE);
  const [summary, setSummary] = useState<ScheduleSummary>(EMPTY_SUMMARY);
  const [books, setBooks] = useState<BookOption[]>([]);

  const [q, setQ] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewTab>('weekly');
  const [recapClassTarget, setRecapClassTarget] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Create / Edit Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<ScheduleRow | null>(null);
  const [formClassName, setFormClassName] = useState(SD_CLASSES[0].className);
  const [formTeacher, setFormTeacher] = useState(SD_CLASSES[0].homeroomTeacher);
  const [formCompanionTeacher, setFormCompanionTeacher] = useState(SD_CLASSES[0].companionTeacher);
  const [formStudentCount, setFormStudentCount] = useState(String(SD_CLASSES[0].studentCount));
  const [formDay, setFormDay] = useState<string>('Senin');
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndTime, setFormEndTime] = useState('09:40');
  const [formRoomArea, setFormRoomArea] = useState<string>(READING_AREAS[0]);
  const [formReadingMode, setFormReadingMode] = useState<string>(READING_MODES[0]);
  const [formTheme, setFormTheme] = useState('');
  const [formBookId, setFormBookId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);

  // Session Attendance Modal
  const [attendanceTarget, setAttendanceTarget] = useState<ScheduleRow | null>(null);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<ScheduleRow | null>(null);
  const [archiving, setArchiving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (dayFilter) sp.set('day', dayFilter);
      if (gradeFilter) sp.set('grade', gradeFilter);
      if (classFilter) sp.set('className', classFilter);
      if (statusFilter) sp.set('status', statusFilter);

      const [filteredRes, allRes] = await Promise.all([
        gatewayFetch(`/api/reading-schedules?${sp.toString()}`, { cache: 'no-store' }),
        sp.toString()
          ? gatewayFetch('/api/reading-schedules', { cache: 'no-store' })
          : Promise.resolve(null),
      ]);

      const data = await filteredRes.json();
      if (!filteredRes.ok) throw new Error(data.error || 'Gagal memuat jadwal baca kelas.');

      setSchedules(data.schedules || []);
      setLogs(data.logs || []);
      if (Array.isArray(data.classes) && data.classes.length > 0) {
        setLiveClasses(data.classes);
      }
      setCoverage(data.coverage || EMPTY_COVERAGE);
      setSummary(data.summary || EMPTY_SUMMARY);
      setBooks(data.books || []);

      if (allRes && allRes.ok) {
        const allData = await allRes.json();
        setAllSchedules(allData.schedules || []);
      } else {
        setAllSchedules(data.schedules || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat jadwal baca kelas.');
    } finally {
      setLoading(false);
    }
  }, [q, dayFilter, gradeFilter, classFilter, statusFilter]);

  useEffect(() => {
    if (authLoading || !user || !canRead) return;
    let active = true;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (dayFilter) sp.set('day', dayFilter);
    if (gradeFilter) sp.set('grade', gradeFilter);
    if (classFilter) sp.set('className', classFilter);
    if (statusFilter) sp.set('status', statusFilter);

    Promise.all([
      gatewayFetch(`/api/reading-schedules?${sp.toString()}`, { cache: 'no-store' }),
      sp.toString()
        ? gatewayFetch('/api/reading-schedules', { cache: 'no-store' })
        : Promise.resolve(null),
    ])
      .then(async ([filteredRes, allRes]) => {
        const data = await filteredRes.json();
        if (!filteredRes.ok) throw new Error(data.error || 'Gagal memuat jadwal baca kelas.');
        const allData = allRes && allRes.ok ? await allRes.json() : null;
        if (!active) return;
        setSchedules(data.schedules || []);
        setLogs(data.logs || []);
        if (Array.isArray(data.classes) && data.classes.length > 0) {
          setLiveClasses(data.classes);
        }
        setCoverage(data.coverage || EMPTY_COVERAGE);
        setSummary(data.summary || EMPTY_SUMMARY);
        setBooks(data.books || []);
        setAllSchedules(allData?.schedules || data.schedules || []);
        setError(null);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat jadwal baca kelas.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user, canRead, q, dayFilter, gradeFilter, classFilter, statusFilter]);

  const liveConflict = useMemo(() => {
    if (!formOpen) return null;
    const res = detectScheduleConflict(
      {
        id: editingRow?.id,
        className: formClassName,
        dayOfWeek: formDay,
        startTime: formStartTime,
        endTime: formEndTime,
        roomArea: formRoomArea,
      },
      allSchedules.map(toDomainRow)
    );
    return res.hasConflict ? res.reason || 'Terjadi bentrok jadwal.' : null;
  }, [formOpen, editingRow?.id, formClassName, formDay, formStartTime, formEndTime, formRoomArea, allSchedules]);

  function findLiveClass(clsName: string): LiveClassPreset {
    return (
      liveClasses.find((c) => c.className === clsName) ||
      SD_CLASSES.find((c) => c.className === clsName) ||
      SD_CLASSES[0]
    );
  }

  function handleSelectClassPreset(cls: string) {
    setFormClassName(cls);
    const preset = findLiveClass(cls);
    if (preset && !editingRow) {
      setFormTeacher(preset.homeroomTeacher);
      setFormCompanionTeacher(preset.companionTeacher);
      setFormStudentCount(String(preset.studentCount));
    }
  }

  function openCreateModal(preselectedClass?: string) {
    const clsName = preselectedClass || coverage.missingClasses[0] || liveClasses[0]?.className || SD_CLASSES[0].className;
    const preset = findLiveClass(clsName);
    setEditingRow(null);
    setFormClassName(preset.className);
    setFormTeacher(preset.homeroomTeacher);
    setFormCompanionTeacher(preset.companionTeacher);
    setFormStudentCount(String(preset.studentCount));
    setFormDay(dayFilter || 'Senin');
    setFormStartTime('09:30');
    setFormEndTime('10:10');
    setFormRoomArea(READING_AREAS[0]);
    setFormReadingMode(READING_MODES[0]);
    setFormTheme(`Kegiatan Literasi ${preset.className}`);
    setFormBookId(books[0] ? String(books[0].id) : '');
    setFormDate('');
    setFormNotes('');
    setFormError(null);
    setFormOpen(true);
  }

  function openEditModal(row: ScheduleRow) {
    const preset = findLiveClass(row.class_name);
    setEditingRow(row);
    setFormClassName(row.class_name);
    setFormTeacher(row.homeroom_teacher || preset.homeroomTeacher);
    setFormCompanionTeacher(row.companion_teacher || preset.companionTeacher);
    setFormStudentCount(String(row.student_count));
    setFormDay(row.day_of_week);
    setFormStartTime(row.start_time);
    setFormEndTime(row.end_time);
    setFormRoomArea(row.room_area);
    setFormReadingMode(row.reading_mode);
    setFormTheme(row.reading_theme || '');
    setFormBookId(row.book_id ? String(row.book_id) : '');
    setFormDate(row.schedule_date || '');
    setFormNotes(row.session_notes || '');
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmitSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (liveConflict) {
      setFormError(liveConflict);
      return;
    }
    setSavingForm(true);
    setFormError(null);
    try {
      const payload = {
        className: formClassName,
        homeroomTeacher: formTeacher.trim(),
        companionTeacher: formCompanionTeacher.trim(),
        studentCount: Number(formStudentCount),
        dayOfWeek: formDay,
        scheduleDate: formDate || null,
        startTime: formStartTime,
        endTime: formEndTime,
        roomArea: formRoomArea,
        readingMode: formReadingMode,
        readingTheme: formTheme,
        bookId: formBookId ? Number(formBookId) : null,
        sessionNotes: formNotes,
      };
      const res = await gatewayFetch(
        editingRow ? `/api/reading-schedules/${editingRow.id}` : '/api/reading-schedules',
        {
          method: editingRow ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Gagal menyimpan jadwal baca.');
        return;
      }
      showToast(
        'success',
        editingRow ? 'Jadwal diperbarui' : 'Jadwal baca ditambahkan',
        `${formClassName} · ${formDay} ${formStartTime}–${formEndTime}`
      );
      setFormOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan jadwal.');
    } finally {
      setSavingForm(false);
    }
  }

  async function handleArchiveConfirm() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await gatewayFetch(`/api/reading-schedules/${archiveTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengarsipkan jadwal.');
      showToast('success', 'Jadwal diarsipkan', `${archiveTarget.schedule_code} (${archiveTarget.class_name})`);
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      showToast('error', 'Gagal mengarsipkan', err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setArchiving(false);
    }
  }

  async function handleAutoGenerate() {
    setGenerating(true);
    try {
      const res = await gatewayFetch('/api/reading-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_missing' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal melengkapi jadwal kelas.');
      showToast('success', 'Penjadwalan otomatis selesai', data.message || 'Jadwal seluruh kelas lengkap.');
      await loadData();
    } catch (err) {
      showToast('error', 'Gagal melengkapi jadwal', err instanceof Error ? err.message : 'Error');
    } finally {
      setGenerating(false);
    }
  }

  const exportRows = useMemo(
    () =>
      schedules.map((s) => ({
        Kode_Jadwal: s.schedule_code,
        Kelas: s.class_name,
        Tingkat: `Kelas ${s.grade_level}`,
        Wali_Kelas: s.homeroom_teacher,
        Guru_Pendamping: s.companion_teacher || '-',
        Jumlah_Siswa: s.student_count,
        Hari: s.day_of_week,
        Waktu: `${s.start_time}-${s.end_time}`,
        Area_Baca: s.room_area,
        Metode: s.reading_mode,
        Tema: s.reading_theme || '-',
        Buku_Acuan: s.book_title || '-',
        Status: s.status,
        Siswa_Hadir: s.students_present,
        Buku_Dibaca: s.books_read_count,
      })),
    [schedules]
  );

  const visibleDays = useMemo(() => {
    if (dayFilter) return READING_DAYS.filter((d) => d === dayFilter);
    return [...READING_DAYS];
  }, [dayFilter]);

  const totalEnrolledStudents = useMemo(
    () => liveClasses.reduce((sum, c) => sum + Number(c.studentCount || 0), 0),
    [liveClasses]
  );

  return (
    <AppShell
      title="Penjadwalan Baca Buku Setiap Kelas"
      description="Kelola jadwal kunjungan literasi seluruh 12 kelas SD (1A–6B), wali kelas & guru pendamping, data siswa tiap kelas, serta absensi dan rekap hadir/tidak hadir per sesi."
      requiredPermission="schedules.read"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={schedules.length === 0}
            onClick={() => exportToCsv('jadwal-baca-kelas-sd', exportRows)}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={schedules.length === 0}
            onClick={() => exportToExcel('jadwal-baca-kelas-sd', 'Jadwal Baca', exportRows)}
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={schedules.length === 0}
            onClick={() =>
              exportToPdf('jadwal-baca-kelas-sd', 'Jadwal Baca Buku Per Kelas SD Lentera Pustaka', exportRows)
            }
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Cetak
          </Button>
          {canWrite && coverage.missingClasses.length > 0 && (
            <Button variant="secondary" size="sm" loading={generating} onClick={handleAutoGenerate}>
              <Sparkles className="h-3.5 w-3.5 text-[#E56B63]" />
              Lengkapi {coverage.missingClasses.length} Kelas
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => openCreateModal()}>
              <Plus className="h-3.5 w-3.5" />
              Tambah Jadwal Baca
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Cakupan Kelas SD (1A–6B)"
            value={`${coverage.coveredCount}/${coverage.totalClasses}`}
            hint={
              coverage.coveredCount === coverage.totalClasses
                ? `100% terjadwal · ${totalEnrolledStudents} siswa terdaftar`
                : `${coverage.missingClasses.length} kelas belum punya slot`
            }
            tone={coverage.coveredCount === coverage.totalClasses ? 'success' : 'warning'}
          />
          <StatCard
            label="Total Sesi Aktif"
            value={summary.activeSessions}
            hint={`${summary.totalSessions} jadwal mingguan + wali & pendamping`}
            tone="neutral"
          />
          <StatCard
            label="Sesi & Absen Tercatat"
            value={logs.length}
            hint={`${summary.totalBooksRead} buku terbaca siswa`}
            tone="accent"
          />
          <StatCard
            label="Kehadiran Sesi Selesai"
            value={`${summary.totalStudentsPresent} / ${summary.totalScheduledStudents}`}
            hint="Siswa hadir dibanding total kuota terjadwal"
            tone="neutral"
          />
        </div>

        {/* Navigation Tabs */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-2.5">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-[#F4F3EE] p-1">
            {(
              [
                { id: 'weekly', label: 'Jadwal Mingguan' },
                { id: 'table', label: 'Tabel Lengkap' },
                { id: 'rosters', label: 'Data Kelas & Siswa' },
                { id: 'recap', label: `Rekap Absensi Sesi (${logs.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                className={cn(
                  'rounded-lg px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
                  viewMode === tab.id
                    ? 'bg-[#222B3A] text-white shadow-xs'
                    : 'text-[#5C5E64] hover:text-[#1E2433]'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="px-2 text-xs text-[#5C5E64] hidden lg:block">
            Setiap kelas dilengkapi <strong className="font-medium text-[#1E2433]">Wali Kelas</strong>,{' '}
            <strong className="font-medium text-[#1E2433]">Guru Pendamping</strong>, dan{' '}
            <strong className="font-medium text-[#1E2433]">Absensi Per Siswa</strong>.
          </p>
        </div>

        {/* SCHEDULE TABS: WEEKLY OR TABLE */}
        {(viewMode === 'weekly' || viewMode === 'table') && (
          <>
            {/* 12-Class Coverage Matrix */}
            <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                    Matriks Kelengkapan Jadwal 12 Kelas SD
                  </h2>
                  <p className="text-xs text-[#5C5E64]">
                    Pilih kelas untuk memfilter jadwal mingguan atau klik tab Data Kelas &amp; Siswa untuk mengelola daftar siswa dan guru pendamping.
                  </p>
                </div>
                {classFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setClassFilter('')}>
                    Tampilkan Semua Kelas
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12">
                {coverage.classBreakdown.map((item) => {
                  const shortLabel = item.className.replace('Kelas ', '');
                  const isSelected = classFilter === item.className;
                  return (
                    <button
                      key={item.className}
                      type="button"
                      onClick={() => setClassFilter(isSelected ? '' : item.className)}
                      className={cn(
                        'flex flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer',
                        isSelected
                          ? 'border-[#222B3A] bg-[#222B3A] text-white'
                          : item.hasSchedule
                            ? 'border-[#E2DFD7] bg-white hover:bg-[#EFECE3]/70 text-[#1E2433]'
                            : 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/70 text-[#1E2433]'
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-1">
                        <span className="font-mono text-xs font-semibold tabular-nums">{shortLabel}</span>
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full shrink-0',
                            item.hasSchedule
                              ? isSelected
                                ? 'bg-emerald-400'
                                : 'bg-emerald-600'
                              : 'bg-amber-500'
                          )}
                        />
                      </div>
                      <span
                        className={cn(
                          'mt-1 font-mono text-[11px] tabular-nums',
                          isSelected ? 'text-white/80' : item.hasSchedule ? 'text-[#5C5E64]' : 'text-amber-800'
                        )}
                      >
                        {item.hasSchedule ? `${item.sessionCount} sesi` : 'Kosong'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Recharts Attendance Comparison Bar Chart */}
            {!loading && !error && (
              <ClassAttendanceBarChart
                logs={logs}
                classes={liveClasses}
                selectedClass={classFilter}
                gradeFilter={gradeFilter}
                onSelectClass={setClassFilter}
              />
            )}

            {/* Filter Bar */}
            <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-3.5">
              <div className="flex flex-1 flex-wrap items-center gap-2.5 min-w-[260px]">
                <SearchField
                  value={q}
                  onChange={setQ}
                  placeholder="Cari kelas, wali kelas, pendamping, tema, buku..."
                  ariaLabel="Cari jadwal baca kelas"
                  className="w-full sm:w-72"
                />
                <select
                  aria-label="Filter hari jadwal"
                  value={dayFilter}
                  onChange={(e) => setDayFilter(e.target.value)}
                  className="h-10 rounded-full border border-[#E2DFD7] bg-white px-3.5 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
                >
                  <option value="">Semua Hari (Sen–Sab)</option>
                  {READING_DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter tingkat kelas"
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                  className="h-10 rounded-full border border-[#E2DFD7] bg-white px-3.5 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
                >
                  <option value="">Semua Tingkat</option>
                  {[1, 2, 3, 4, 5, 6].map((g) => (
                    <option key={g} value={String(g)}>
                      Kelas {g}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter status jadwal"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-10 rounded-full border border-[#E2DFD7] bg-white px-3.5 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
                >
                  <option value="">Semua Status</option>
                  <option value="Terjadwal">Terjadwal</option>
                  <option value="Berlangsung">Berlangsung</option>
                  <option value="Selesai">Selesai</option>
                  <option value="Ditunda">Ditunda</option>
                  <option value="Dibatalkan">Dibatalkan</option>
                </select>
                {(q || dayFilter || gradeFilter || classFilter || statusFilter) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQ('');
                      setDayFilter('');
                      setGradeFilter('');
                      setClassFilter('');
                      setStatusFilter('');
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {loading && <LoadingState rows={5} />}
            {error && <ErrorState message={error} onRetry={loadData} />}

            {!loading && !error && schedules.length === 0 && (
              <EmptyState
                title="Belum ada jadwal baca untuk filter ini"
                description={
                  classFilter
                    ? `${classFilter} belum memiliki jadwal pada filter saat ini.`
                    : 'Sesuaikan kata kunci atau tambahkan jadwal baca baru untuk kelas SD.'
                }
                action={
                  canWrite ? (
                    <Button onClick={() => openCreateModal(classFilter || undefined)}>
                      <Plus className="h-4 w-4" />
                      {classFilter ? `Jadwalkan ${classFilter}` : 'Tambah Jadwal Baca'}
                    </Button>
                  ) : undefined
                }
              />
            )}

            {/* WEEKLY TIMETABLE VIEW */}
            {!loading && !error && schedules.length > 0 && viewMode === 'weekly' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleDays.map((day) => {
                  const dayItems = schedules.filter((s) => s.day_of_week === day);
                  return (
                    <section
                      key={day}
                      className="flex flex-col overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]"
                    >
                      <header className="flex items-center justify-between border-b border-[#E7E4DC] bg-[#F4F3EE] px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-[#E56B63]" />
                          <h3 className="font-serif text-base font-semibold text-[#1E2433]">{day}</h3>
                        </div>
                        <span className="font-mono text-xs font-medium text-[#5C5E64] tabular-nums">
                          {dayItems.length} sesi
                        </span>
                      </header>

                      <div className="flex-1 divide-y divide-[#EAE7DF] p-3 space-y-3">
                        {dayItems.length === 0 ? (
                          <p className="py-6 text-center text-xs text-[#7B7D82]">
                            Tidak ada jadwal pada hari {day} sesuai filter.
                          </p>
                        ) : (
                          dayItems.map((item) => (
                            <article key={item.id} className="pt-3 first:pt-0 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-serif text-base font-semibold text-[#1E2433]">
                                      {item.class_name}
                                    </span>
                                    <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
                                      {item.start_time}–{item.end_time}
                                    </span>
                                  </div>
                                  <p className="text-xs font-medium text-[#4A4945] truncate">
                                    {item.reading_theme || item.reading_mode}
                                  </p>
                                </div>
                                <StatusIndicator status={item.status} />
                              </div>

                              <div className="space-y-1 text-xs text-[#5C5E64]">
                                <p className="flex items-center gap-1.5 truncate">
                                  <GraduationCap className="h-3.5 w-3.5 shrink-0 text-[#222B3A]" />
                                  <span className="truncate">
                                    <span className="text-[#7B7D82]">Wali:</span> {item.homeroom_teacher}
                                  </span>
                                  <span className="font-mono tabular-nums shrink-0 text-[#7B7D82]">
                                    ({item.student_count} siswa)
                                  </span>
                                </p>
                                <p className="flex items-center gap-1.5 truncate">
                                  <UserCheck className="h-3.5 w-3.5 shrink-0 text-[#E56B63]" />
                                  <span className="truncate">
                                    <span className="text-[#7B7D82]">Pendamping:</span>{' '}
                                    {item.companion_teacher || '-'}
                                  </span>
                                </p>
                                <p className="flex items-center gap-1.5 truncate">
                                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[#8A8B90]" />
                                  <span className="truncate">
                                    {item.room_area} · {item.reading_mode}
                                  </span>
                                </p>
                                {item.book_title && (
                                  <p className="flex items-center gap-1.5 truncate text-[#1E2433]">
                                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-[#E56B63]" />
                                    <span className="truncate">{item.book_title}</span>
                                  </p>
                                )}
                              </div>

                              {item.status === 'Selesai' && (
                                <p className="rounded-lg bg-emerald-50/80 px-2.5 py-1.5 font-mono text-[11px] text-emerald-900 tabular-nums">
                                  Realisasi: {item.students_present}/{item.student_count} siswa hadir ·{' '}
                                  {item.books_read_count} buku dibaca
                                </p>
                              )}

                              {canWrite && (
                                <div className="no-print flex flex-wrap items-center gap-1.5 pt-1">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setAttendanceTarget(item)}
                                  >
                                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-700" />
                                    Catat Sesi &amp; Absen
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openEditModal(item)}
                                    aria-label={`Edit jadwal ${item.class_name}`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setArchiveTarget(item)}
                                    aria-label={`Arsipkan jadwal ${item.class_name}`}
                                  >
                                    <Archive className="h-3.5 w-3.5 text-[#C94A43]" />
                                    Arsip
                                  </Button>
                                </div>
                              )}
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            {/* DENSE TABLE VIEW */}
            {!loading && !error && schedules.length > 0 && viewMode === 'table' && (
              <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-[#5C5E64]">
                      <tr>
                        <th className="px-4 py-3">Kode</th>
                        <th className="px-4 py-3">Kelas, Wali &amp; Pendamping</th>
                        <th className="px-4 py-3">Hari &amp; Jam</th>
                        <th className="px-4 py-3">Area &amp; Metode</th>
                        <th className="px-4 py-3">Buku &amp; Tema</th>
                        <th className="px-4 py-3 text-right">Kehadiran</th>
                        <th className="px-4 py-3">Status</th>
                        {canWrite && <th className="no-print px-4 py-3 text-right">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {schedules.map((s) => (
                        <tr key={s.id} className="hover:bg-[#F4F3EE]/70">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-[#1E2433] whitespace-nowrap">
                            {s.schedule_code}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#1E2433]">{s.class_name}</p>
                            <p className="text-xs text-[#5C5E64]">Wali: {s.homeroom_teacher}</p>
                            <p className="text-xs text-[#7B7D82]">
                              Pendamping: {s.companion_teacher || '-'}
                            </p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-medium text-[#1E2433]">{s.day_of_week}</p>
                            <p className="font-mono text-xs text-[#5C5E64] tabular-nums">
                              {s.start_time}–{s.end_time} WIB
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[#1E2433]">{s.room_area}</p>
                            <p className="text-xs text-[#5C5E64]">{s.reading_mode}</p>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <p className="truncate font-medium text-[#1E2433]">{s.book_title || '-'}</p>
                            <p className="truncate text-xs text-[#5C5E64]">{s.reading_theme || '-'}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                            {s.students_present}/{s.student_count} siswa
                          </td>
                          <td className="px-4 py-3">
                            <StatusIndicator status={s.status} />
                          </td>
                          {canWrite && (
                            <td className="no-print px-4 py-3 text-right">
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setAttendanceTarget(s)}
                                >
                                  Catat &amp; Absen
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => openEditModal(s)}>
                                  Edit
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(s)}>
                                  Arsip
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* EXECUTION LOGS JOURNAL */}
            {!loading && !error && (
              <section className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E7E4DC] px-5 py-4">
                  <div>
                    <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                      Riwayat Pelaksanaan &amp; Ringkasan Absensi Sesi
                    </h2>
                    <p className="text-xs text-[#5C5E64]">
                      Menampilkan ringkasan siapa yang hadir dan tidak hadir pada setiap sesi literasi yang telah dicatat.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
                      {logs.length} catatan
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setRecapClassTarget('');
                        setViewMode('recap');
                      }}
                    >
                      <Users className="h-3.5 w-3.5" />
                      Buka Rekap Lengkap
                    </Button>
                  </div>
                </div>

                {logs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#7B7D82]">
                    Belum ada catatan pelaksanaan sesi baca yang direkam.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-[#5C5E64]">
                        <tr>
                          <th className="px-4 py-2.5">Tanggal</th>
                          <th className="px-4 py-2.5">Kelas &amp; Kode</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Hadir</th>
                          <th className="px-4 py-2.5">Tidak Hadir (Nama &amp; Status)</th>
                          <th className="px-4 py-2.5 text-right">Buku</th>
                          <th className="no-print px-4 py-2.5 text-right">Rekap</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE7DF]">
                        {logs.slice(0, 15).map((l) => {
                          const attSum = l.attendance_summary;
                          const absentList = attSum?.absentStudents || [];
                          return (
                            <tr key={l.id} className="hover:bg-[#F4F3EE]/70">
                              <td className="px-4 py-2.5 font-mono text-xs text-[#5C5E64] tabular-nums whitespace-nowrap">
                                {l.session_date}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="font-medium text-[#1E2433]">{l.class_name}</span>
                                <span className="ml-2 font-mono text-xs text-[#7B7D82]">
                                  {l.schedule_code}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <StatusIndicator status={l.status} />
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                                {attSum
                                  ? `${attSum.presentCount}/${attSum.totalStudents}`
                                  : l.students_present}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-[#4A4945] max-w-sm">
                                {attSum ? (
                                  absentList.length === 0 ? (
                                    <span className="text-emerald-700 font-medium">
                                      Hadir semua
                                    </span>
                                  ) : (
                                    <span className="text-[#9E352F]">
                                      {absentList
                                        .map((a) => `${a.studentName} (${a.status})`)
                                        .join(', ')}
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[#7B7D82]">Rekap agregat</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-[#E56B63] tabular-nums">
                                {l.books_read_count}
                              </td>
                              <td className="no-print px-4 py-2.5 text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setRecapClassTarget(l.class_name);
                                    setViewMode('recap');
                                  }}
                                >
                                  Lihat Rekap
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* TAB 3: DATA KELAS, WALI, PENDAMPING & SISWA */}
        {viewMode === 'rosters' && (
          <ClassRosterPanel
            initialClassName={classFilter || SD_CLASSES[0].className}
            canWrite={canWrite}
            onDataChanged={loadData}
          />
        )}

        {/* TAB 4: REKAP ABSENSI SESI */}
        {viewMode === 'recap' && (
          <AttendanceRecapPanel
            key={recapClassTarget || 'all'}
            logs={logs}
            initialClassFilter={recapClassTarget}
          />
        )}
      </div>

      {/* CREATE / EDIT SCHEDULE MODAL */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingRow ? `Edit Jadwal ${editingRow.class_name}` : 'Tambah Jadwal Baca Kelas SD'}
        description="Sistem otomatis memeriksa bentrok ruang baca maupun bentrok jadwal kelas pada hari & jam yang sama."
      >
        <form onSubmit={handleSubmitSchedule} className="space-y-4">
          {(formError || liveConflict) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] p-3 text-xs text-[#9E352F]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#C94A43]" />
              <span>{formError || liveConflict}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Kelas SD"
              value={formClassName}
              onChange={(e) => handleSelectClassPreset(e.target.value)}
            >
              {liveClasses.map((c) => (
                <option key={c.className} value={c.className}>
                  {c.className} (Tingkat {c.gradeLevel})
                </option>
              ))}
            </SelectField>
            <TextField
              label="Jumlah Siswa Kelas"
              type="number"
              min={1}
              max={60}
              value={formStudentCount}
              onChange={(e) => setFormStudentCount(e.target.value)}
              required
            />
            <TextField
              label="Wali Kelas"
              value={formTeacher}
              onChange={(e) => setFormTeacher(e.target.value)}
              required
            />
            <TextField
              label="Guru Pendamping"
              value={formCompanionTeacher}
              onChange={(e) => setFormCompanionTeacher(e.target.value)}
              required
            />
            <SelectField label="Hari Rutin" value={formDay} onChange={(e) => setFormDay(e.target.value)}>
              {READING_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label="Jam Mulai (WIB)"
                type="time"
                value={formStartTime}
                onChange={(e) => setFormStartTime(e.target.value)}
                required
              />
              <TextField
                label="Jam Selesai (WIB)"
                type="time"
                value={formEndTime}
                onChange={(e) => setFormEndTime(e.target.value)}
                required
              />
            </div>
            <SelectField
              label="Area / Pojok Baca"
              value={formRoomArea}
              onChange={(e) => setFormRoomArea(e.target.value)}
            >
              {READING_AREAS.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Metode Kegiatan Membaca"
              value={formReadingMode}
              onChange={(e) => setFormReadingMode(e.target.value)}
            >
              {READING_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Buku Acuan / Koleksi SD (opsional)"
              value={formBookId}
              onChange={(e) => setFormBookId(e.target.value)}
            >
              <option value="">Pilihan Bebas di Rak</option>
              {books.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.title}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Tanggal Khusus (opsional)"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
            />
          </div>

          <TextField
            label="Tema / Fokus Bacaan"
            placeholder="Misal: Mengenal Fabel Nusantara & Pesan Moral"
            value={formTheme}
            onChange={(e) => setFormTheme(e.target.value)}
          />
          <TextField
            label="Catatan Persiapan"
            placeholder="Instruksi singkat untuk petugas, wali kelas, atau pendamping"
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
          />

          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={savingForm} disabled={Boolean(liveConflict)}>
              <Clock className="h-4 w-4" />
              {editingRow ? 'Simpan Perubahan' : 'Simpan Jadwal Baca'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* SESSION ATTENDANCE MODAL */}
      {attendanceTarget && (
        <SessionAttendanceModal
          key={String(attendanceTarget.id)}
          schedule={attendanceTarget}
          onClose={() => setAttendanceTarget(null)}
          onSaved={loadData}
        />
      )}

      {/* ARCHIVE CONFIRM */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchiveConfirm}
        title="Arsipkan Jadwal Baca?"
        message={`Jadwal ${archiveTarget?.schedule_code} untuk ${archiveTarget?.class_name} (${archiveTarget?.day_of_week} ${archiveTarget?.start_time}–${archiveTarget?.end_time}) akan diarsipkan. Riwayat jurnal pelaksanaan dan absensi tetap tersimpan untuk audit sekolah.`}
        confirmLabel="Arsipkan Jadwal"
        loading={archiving}
      />
    </AppShell>
  );
}
