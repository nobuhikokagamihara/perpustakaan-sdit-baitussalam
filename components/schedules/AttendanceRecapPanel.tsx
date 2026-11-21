'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  GraduationCap,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  SearchField,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { exportToCsv, exportToExcel, exportToPdf } from '@/lib/client/export';
import {
  SD_CLASSES,
  compareClassNames,
  extractGradeLevel,
  summarizeSessionAttendance,
  type AttendanceStatus,
} from '@/lib/domain/reading-schedule-rules';
import { toSafeFilenameSlug } from '@/lib/domain/report-filters';
import { cn } from '@/lib/utils';
import { ClassAttendanceBarChart } from './ClassAttendanceBarChart';
import type { LiveClassPreset, ScheduleLogRow } from './types';

interface AttendanceRecapPanelProps {
  logs: ScheduleLogRow[];
  classes?: ReadonlyArray<Pick<LiveClassPreset, 'className' | 'gradeLevel'>>;
  initialClassFilter?: string;
}

function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  const styles: Record<AttendanceStatus, string> = {
    Hadir: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Izin: 'border-amber-200 bg-amber-50 text-amber-800',
    Sakit: 'border-sky-200 bg-sky-50 text-sky-800',
    Alpa: 'border-[#F2C6C3] bg-[#FDF2F1] text-[#9E352F]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        styles[status] || styles.Hadir
      )}
    >
      {status}
    </span>
  );
}

export function AttendanceRecapPanel({
  logs,
  classes = SD_CLASSES,
  initialClassFilter = '',
}: AttendanceRecapPanelProps) {
  const { library } = useAuth();
  const [classFilter, setClassFilter] = useState(initialClassFilter);
  const [q, setQ] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const classOptions = useMemo(() => {
    const map = new Map<string, { className: string; gradeLevel: number }>();
    for (const c of classes) {
      map.set(c.className.trim().toLowerCase(), {
        className: c.className.trim(),
        gradeLevel: c.gradeLevel,
      });
    }
    for (const log of logs) {
      const name = String(log.class_name || '').trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), {
          className: name,
          gradeLevel: extractGradeLevel(name),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => compareClassNames(a.className, b.className));
  }, [classes, logs]);

  const searchMatchedLogs = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((log) => {
      const inMeta =
        log.class_name.toLowerCase().includes(term) ||
        log.schedule_code.toLowerCase().includes(term) ||
        (log.homeroom_teacher || '').toLowerCase().includes(term) ||
        (log.companion_teacher || '').toLowerCase().includes(term) ||
        (log.notes || '').toLowerCase().includes(term) ||
        log.session_date.includes(term);
      if (inMeta) return true;
      return (log.attendance || []).some(
        (a) =>
          a.studentName.toLowerCase().includes(term) ||
          a.studentCode.toLowerCase().includes(term) ||
          a.status.toLowerCase().includes(term) ||
          (a.note || '').toLowerCase().includes(term)
      );
    });
  }, [logs, q]);

  const filteredLogs = useMemo(() => {
    if (!classFilter) return searchMatchedLogs;
    return searchMatchedLogs.filter((log) => log.class_name === classFilter);
  }, [searchMatchedLogs, classFilter]);

  const totals = useMemo(() => {
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalIzin = 0;
    let totalSakit = 0;
    let totalAlpa = 0;
    let totalBooks = 0;
    for (const log of filteredLogs) {
      const summary =
        log.attendance_summary ||
        (log.attendance && log.attendance.length > 0
          ? summarizeSessionAttendance(log.attendance)
          : null);
      if (summary) {
        totalPresent += summary.presentCount;
        totalAbsent += summary.absentCount;
        totalIzin += summary.izinCount;
        totalSakit += summary.sakitCount;
        totalAlpa += summary.alpaCount;
        totalBooks += summary.totalBooksRead;
      } else {
        totalPresent += log.students_present;
        totalBooks += log.books_read_count;
      }
    }
    return { totalPresent, totalAbsent, totalIzin, totalSakit, totalAlpa, totalBooks };
  }, [filteredLogs]);

  const exportRows = useMemo(
    () =>
      filteredLogs.map((log) => {
        const summary =
          log.attendance_summary ||
          (log.attendance && log.attendance.length > 0
            ? summarizeSessionAttendance(log.attendance)
            : null);
        const absentText = summary
          ? summary.absentStudents
              .map((a) => `${a.studentName} (${a.status}${a.note ? `: ${a.note}` : ''})`)
              .join('; ') || 'Nihil (Hadir semua)'
          : '-';
        const presentText = summary
          ? summary.presentStudents.map((p) => p.studentName).join('; ')
          : `${log.students_present} siswa`;
        return {
          Tanggal: log.session_date,
          Kelas: log.class_name,
          Kode_Jadwal: log.schedule_code,
          Wali_Kelas: log.homeroom_teacher || '-',
          Guru_Pendamping: log.companion_teacher || '-',
          Status_Sesi: log.status,
          Hadir: summary ? summary.presentCount : log.students_present,
          Tidak_Hadir: summary ? summary.absentCount : 0,
          Izin: summary?.izinCount ?? 0,
          Sakit: summary?.sakitCount ?? 0,
          Alpa: summary?.alpaCount ?? 0,
          Buku_Dibaca: log.books_read_count,
          Daftar_Tidak_Hadir: absentText,
          Daftar_Hadir: presentText,
          Catatan: log.notes || '-',
        };
      }),
    [filteredLogs]
  );

  function toggleExpand(id: number | string) {
    const key = String(id);
    setExpandedIds((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-5">
      {/* Filter & Export Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-3.5">
        <div className="flex flex-1 flex-wrap items-center gap-2.5 min-w-[260px]">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Cari kelas, nama siswa hadir/absen, wali kelas..."
            ariaLabel="Cari rekap absensi sesi baca"
            className="w-full sm:w-72"
          />
          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#5C5E64]">
            <span>Rombel/Kelas</span>
            <select
              aria-label="Filter Rombel/Kelas pada rekap absensi"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="h-10 rounded-full border border-[#E2DFD7] bg-white px-3.5 text-xs font-normal text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
            >
              <option value="">Semua Rombel/Kelas ({classOptions.length})</option>
              {classOptions.map((c) => (
                <option key={c.className} value={c.className}>
                  {c.className}
                </option>
              ))}
            </select>
          </label>
          {(q || classFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setClassFilter('');
              }}
            >
              Reset
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToCsv(
                classFilter
                  ? `rekap-absensi-sesi-baca-${toSafeFilenameSlug(classFilter)}`
                  : 'rekap-absensi-sesi-baca',
                exportRows
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToExcel(
                classFilter
                  ? `rekap-absensi-sesi-baca-${toSafeFilenameSlug(classFilter)}`
                  : 'rekap-absensi-sesi-baca',
                classFilter ? `Rekap Absensi ${classFilter}` : 'Rekap Absensi',
                exportRows
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportRows.length === 0}
            onClick={() =>
              exportToPdf(
                classFilter
                  ? `rekap-absensi-sesi-baca-${toSafeFilenameSlug(classFilter)}`
                  : 'rekap-absensi-sesi-baca',
                classFilter
                  ? `Rekap Absensi Sesi Baca — ${classFilter}`
                  : 'Rekap Absensi Hadir & Tidak Hadir Sesi Baca Kelas SD',
                exportRows,
                library
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Aggregate Recap Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] px-3.5 py-2.5">
          <p className="text-[11px] text-[#5C5E64]">Total Sesi Terekam</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-[#1E2433] tabular-nums">
            {filteredLogs.length}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
          <p className="text-[11px] text-emerald-800">Total Kehadiran</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-900 tabular-nums">
            {totals.totalPresent}
          </p>
        </div>
        <div className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1]/70 px-3.5 py-2.5">
          <p className="text-[11px] text-[#9E352F]">Total Tidak Hadir</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-[#9E352F] tabular-nums">
            {totals.totalAbsent}
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
          <p className="text-[11px] text-amber-800">Izin</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-amber-900 tabular-nums">
            {totals.totalIzin}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2.5">
          <p className="text-[11px] text-sky-800">Sakit / Alpa</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-sky-900 tabular-nums">
            {totals.totalSakit} / {totals.totalAlpa}
          </p>
        </div>
        <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] px-3.5 py-2.5">
          <p className="text-[11px] text-[#5C5E64]">Buku Dibaca</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-[#E56B63] tabular-nums">
            {totals.totalBooks}
          </p>
        </div>
      </div>

      {/* Recharts Class Attendance Comparison Chart */}
      <ClassAttendanceBarChart
        logs={searchMatchedLogs}
        classes={classOptions}
        selectedClass={classFilter}
        onSelectClass={setClassFilter}
        title="Grafik Kehadiran vs Tidak Hadir per Rombel Kelas"
        description="Perbandingan total siswa hadir dan tidak hadir pada sesi literasi. Klik batang kelas untuk memfilter rekap di bawah."
      />

      {/* Session Attendance Cards */}
      {filteredLogs.length === 0 ? (
        <EmptyState
          title="Belum ada rekap absensi untuk filter ini"
          description="Catat pelaksanaan sesi baca dari tab Jadwal Mingguan atau Tabel Lengkap agar daftar hadir & tidak hadir siswa tampil di sini."
        />
      ) : (
        <div className="space-y-4">
          {filteredLogs.map((log) => {
            const attendanceList = log.attendance || [];
            const summary =
              log.attendance_summary ||
              (attendanceList.length > 0 ? summarizeSessionAttendance(attendanceList) : null);
            const isExpanded = Boolean(expandedIds[String(log.id)]);

            return (
              <article
                key={log.id}
                className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]"
              >
                {/* Session Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E7E4DC] bg-[#F4F3EE] px-5 py-3.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#1E2433] tabular-nums">
                        <CalendarDays className="h-3.5 w-3.5 text-[#E56B63]" />
                        {log.session_date}
                      </span>
                      <span className="font-serif text-base font-semibold text-[#1E2433]">
                        {log.class_name}
                      </span>
                      <span className="font-mono text-xs text-[#7B7D82]">{log.schedule_code}</span>
                      <StatusIndicator status={log.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#5C5E64]">
                      <span>
                        {log.day_of_week}
                        {log.start_time && log.end_time ? ` · ${log.start_time}–${log.end_time} WIB` : ''}
                        {log.room_area ? ` · ${log.room_area}` : ''}
                      </span>
                      {log.homeroom_teacher && (
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="h-3.5 w-3.5 text-[#222B3A]" />
                          Wali: <strong className="font-medium text-[#1E2433]">{log.homeroom_teacher}</strong>
                        </span>
                      )}
                      {log.companion_teacher && (
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="h-3.5 w-3.5 text-[#E56B63]" />
                          Pendamping:{' '}
                          <strong className="font-medium text-[#1E2433]">{log.companion_teacher}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick Metrics */}
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                    <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
                      Hadir: {summary ? `${summary.presentCount}/${summary.totalStudents} (${summary.attendanceRate}%)` : `${log.students_present} siswa`}
                    </span>
                    {summary && (
                      <span
                        className={cn(
                          'rounded-lg border px-2.5 py-1 font-semibold',
                          summary.absentCount > 0
                            ? 'border-[#F2C6C3] bg-[#FDF2F1] text-[#9E352F]'
                            : 'border-emerald-200 bg-white text-emerald-700'
                        )}
                      >
                        Tidak Hadir: {summary.absentCount}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-lg border border-[#E2DFD7] bg-white px-2.5 py-1 font-semibold text-[#E56B63]">
                      <BookOpen className="h-3.5 w-3.5" />
                      {log.books_read_count} buku
                    </span>
                  </div>
                </div>

                {/* Body: Absent Highlight + Present Summary */}
                <div className="p-5 space-y-4">
                  {summary ? (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      {/* Daftar Tidak Hadir */}
                      <div
                        className={cn(
                          'rounded-xl border p-3.5 space-y-2',
                          summary.absentCount > 0
                            ? 'border-[#F2C6C3] bg-[#FDF2F1]/70'
                            : 'border-emerald-200 bg-emerald-50/50'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#1E2433]">
                            {summary.absentCount > 0 ? (
                              <UserX className="h-4 w-4 text-[#C94A43]" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                            )}
                            Siswa Tidak Hadir ({summary.absentCount})
                          </h4>
                          <span className="font-mono text-[11px] text-[#5C5E64] tabular-nums">
                            Izin {summary.izinCount} · Sakit {summary.sakitCount} · Alpa {summary.alpaCount}
                          </span>
                        </div>
                        {summary.absentStudents.length === 0 ? (
                          <p className="text-xs text-emerald-800">
                            Semua siswa hadir lengkap pada sesi ini.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {summary.absentStudents.map((st) => (
                              <li
                                key={st.studentId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#F2C6C3]/80 bg-white px-3 py-1.5 text-xs"
                              >
                                <div className="min-w-0">
                                  <span className="font-medium text-[#1E2433]">{st.studentName}</span>
                                  <span className="ml-1.5 font-mono text-[10px] text-[#7B7D82]">
                                    {st.studentCode}
                                  </span>
                                  {st.note && (
                                    <p className="text-[11px] text-[#5C5E64]">{st.note}</p>
                                  )}
                                </div>
                                <AttendanceBadge status={st.status} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Daftar Hadir */}
                      <div className="rounded-xl border border-[#E7E4DC] bg-white p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#1E2433]">
                            <Users className="h-4 w-4 text-emerald-700" />
                            Siswa Hadir ({summary.presentCount})
                          </h4>
                          <span className="font-mono text-[11px] text-emerald-700 tabular-nums">
                            {summary.attendanceRate}% kehadiran
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {summary.presentStudents.map((st) => (
                            <span
                              key={st.studentId}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-2 py-0.5 text-[11px] text-[#1E2433]"
                            >
                              <span>{st.studentName}</span>
                              {st.booksRead > 0 && (
                                <span className="font-mono text-[10px] text-[#E56B63] tabular-nums">
                                  ({st.booksRead}b)
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-[#E7E4DC] bg-white px-3.5 py-2.5 text-xs text-[#5C5E64]">
                      <AlertCircle className="h-4 w-4 text-[#8A8B90]" />
                      <span>
                        Sesi ini dicatat secara agregat ({log.students_present} siswa hadir,{' '}
                        {log.books_read_count} buku dibaca) tanpa daftar absen per siswa.
                      </span>
                    </div>
                  )}

                  {log.notes && (
                    <p className="text-xs text-[#4A4945]">
                      <strong className="font-medium text-[#1E2433]">Catatan Sesi:</strong> {log.notes}{' '}
                      <span className="text-[#7B7D82]">— dicatat oleh {log.recorded_by_name || 'Petugas'}</span>
                    </p>
                  )}

                  {/* Expandable Full Attendance Table */}
                  {attendanceList.length > 0 && (
                    <div className="border-t border-[#E7E4DC] pt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(log.id)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                        {isExpanded
                          ? 'Sembunyikan Detail Absensi'
                          : `Lihat Daftar Lengkap Hadir & Tidak Hadir (${attendanceList.length} siswa)`}
                      </Button>

                      {isExpanded && (
                        <div className="mt-3 overflow-x-auto rounded-xl border border-[#E7E4DC] bg-white">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] font-medium text-[#5C5E64]">
                              <tr>
                                <th className="px-3 py-2 text-center w-10">No</th>
                                <th className="px-3 py-2">NIS</th>
                                <th className="px-3 py-2">Nama Siswa</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2 text-right">Buku Dibaca</th>
                                <th className="px-3 py-2">Keterangan</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#EAE7DF]">
                              {attendanceList.map((entry, idx) => (
                                <tr key={`${log.id}-${entry.studentId}`} className="hover:bg-[#FAF9F5]">
                                  <td className="px-3 py-2 text-center font-mono text-[#7B7D82] tabular-nums">
                                    {idx + 1}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-[#5C5E64] whitespace-nowrap">
                                    {entry.studentCode}
                                  </td>
                                  <td className="px-3 py-2 font-medium text-[#1E2433]">
                                    {entry.studentName}
                                  </td>
                                  <td className="px-3 py-2">
                                    <AttendanceBadge status={entry.status} />
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[#E56B63]">
                                    {entry.booksRead}
                                  </td>
                                  <td className="px-3 py-2 text-[#5C5E64]">{entry.note || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
