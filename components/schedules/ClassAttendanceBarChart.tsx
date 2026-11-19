'use client';

import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  SD_CLASSES,
  computeClassAttendanceComparison,
  type ClassAttendanceComparisonEntry,
} from '@/lib/domain/reading-schedule-rules';
import { cn } from '@/lib/utils';
import type { LiveClassPreset, ScheduleLogRow } from './types';

interface ClassAttendanceBarChartProps {
  logs: ScheduleLogRow[];
  classes?: ReadonlyArray<Pick<LiveClassPreset, 'className' | 'gradeLevel'>>;
  selectedClass?: string;
  gradeFilter?: string;
  onSelectClass?: (className: string) => void;
  title?: string;
  description?: string;
}

type ScopeMode = 'all' | 'recorded';
type BarLayoutMode = 'grouped' | 'stacked';

const COLOR_PRESENT = '#1F7A5A';
const COLOR_PRESENT_DIM = '#9EC5B5';
const COLOR_ABSENT = '#D9534F';
const COLOR_ABSENT_DIM = '#EAB2B0';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: ClassAttendanceComparisonEntry;
  }>;
}

function AttendanceTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;

  return (
    <div className="min-w-[210px] rounded-xl border border-[#E2DFD7] bg-white p-3 text-xs shadow-md">
      <div className="flex items-center justify-between gap-3 border-b border-[#EAE7DF] pb-2">
        <span className="font-serif text-sm font-semibold text-[#1E2433]">{entry.className}</span>
        <span className="font-mono text-[11px] text-[#5C5E64] tabular-nums">
          {entry.sessionsCount} sesi
        </span>
      </div>

      {entry.hasRecordedSession ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[#4A4945]">
              <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#1F7A5A]" />
              Hadir
            </span>
            <span className="font-mono font-semibold text-[#1E2433] tabular-nums">
              {entry.presentCount} siswa
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[#4A4945]">
              <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#D9534F]" />
              Tidak Hadir
            </span>
            <span className="font-mono font-semibold text-[#9E352F] tabular-nums">
              {entry.absentCount} siswa
            </span>
          </div>

          {entry.absentCount > 0 && (entry.izinCount > 0 || entry.sakitCount > 0 || entry.alpaCount > 0) && (
            <p className="border-t border-[#F0EDE6] pt-1.5 font-mono text-[11px] text-[#5C5E64] tabular-nums">
              Izin {entry.izinCount} · Sakit {entry.sakitCount} · Alpa {entry.alpaCount}
            </p>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-[#EAE7DF] pt-1.5 text-[11px] text-[#5C5E64]">
            <span>Tingkat Kehadiran</span>
            <span className="font-mono font-semibold text-[#1F7A5A] tabular-nums">
              {entry.attendanceRate}%
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-[#7B7D82]">
          Belum ada catatan absensi sesi literasi untuk kelas ini.
        </p>
      )}
    </div>
  );
}

export function ClassAttendanceBarChart({
  logs,
  classes = SD_CLASSES,
  selectedClass = '',
  gradeFilter = '',
  onSelectClass,
  title = 'Perbandingan Kehadiran Siswa per Kelas',
  description = 'Grafik batang total siswa hadir vs tidak hadir selama sesi literasi. Klik batang kelas untuk memfilter data.',
}: ClassAttendanceBarChartProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
  const [layoutMode, setLayoutMode] = useState<BarLayoutMode>('grouped');

  const scopedPresets = useMemo(() => {
    if (!gradeFilter) return classes;
    return classes.filter((c) => String(c.gradeLevel) === String(gradeFilter));
  }, [classes, gradeFilter]);

  const scopedLogs = useMemo(() => {
    if (!gradeFilter) return logs;
    const allowed = new Set(scopedPresets.map((c) => c.className.toLowerCase()));
    return logs.filter((l) => allowed.has(String(l.class_name || '').trim().toLowerCase()));
  }, [logs, gradeFilter, scopedPresets]);

  const comparison = useMemo(
    () => computeClassAttendanceComparison(scopedLogs, scopedPresets),
    [scopedLogs, scopedPresets]
  );

  const chartData = useMemo(() => {
    if (scopeMode === 'recorded') {
      return comparison.classes.filter((c) => c.hasRecordedSession);
    }
    return comparison.classes;
  }, [comparison.classes, scopeMode]);

  const handleBarSelect = (entry?: ClassAttendanceComparisonEntry) => {
    if (!onSelectClass || !entry) return;
    onSelectClass(selectedClass === entry.className ? '' : entry.className);
  };

  return (
    <section
      data-testid="class-attendance-bar-chart"
      aria-label="Grafik perbandingan siswa hadir dan tidak hadir per kelas"
      className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4 sm:p-5 space-y-4"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#E56B63] shrink-0" />
            <h2 className="font-serif text-base font-semibold text-[#1E2433]">{title}</h2>
          </div>
          <p className="text-xs text-[#5C5E64]">{description}</p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Cakupan kelas pada grafik"
            className="flex items-center gap-1 rounded-lg bg-[#F4F3EE] p-1"
          >
            <button
              type="button"
              onClick={() => setScopeMode('all')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
                scopeMode === 'all'
                  ? 'bg-[#222B3A] text-white'
                  : 'text-[#5C5E64] hover:text-[#1E2433]'
              )}
            >
              Semua Kelas ({comparison.classes.length})
            </button>
            <button
              type="button"
              onClick={() => setScopeMode('recorded')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
                scopeMode === 'recorded'
                  ? 'bg-[#222B3A] text-white'
                  : 'text-[#5C5E64] hover:text-[#1E2433]'
              )}
            >
              Tercatat ({comparison.classesWithSessions})
            </button>
          </div>

          <div
            role="group"
            aria-label="Mode tampilan grafik batang"
            className="flex items-center gap-1 rounded-lg bg-[#F4F3EE] p-1"
          >
            <button
              type="button"
              onClick={() => setLayoutMode('grouped')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
                layoutMode === 'grouped'
                  ? 'bg-white text-[#1E2433] shadow-xs'
                  : 'text-[#5C5E64] hover:text-[#1E2433]'
              )}
            >
              Berdampingan
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('stacked')}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer',
                layoutMode === 'stacked'
                  ? 'bg-white text-[#1E2433] shadow-xs'
                  : 'text-[#5C5E64] hover:text-[#1E2433]'
              )}
            >
              Tumpuk
            </button>
          </div>
        </div>
      </div>

      {/* Inline Legend & Quantitative Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[#EAE7DF] py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-[#1E2433]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#1F7A5A]" />
            <span>Hadir</span>
            <strong className="font-mono font-semibold tabular-nums">
              {comparison.totalPresent}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#1E2433]">
            <span className="inline-block h-2.5 w-2.5 rounded-xs bg-[#D9534F]" />
            <span>Tidak Hadir</span>
            <strong className="font-mono font-semibold text-[#9E352F] tabular-nums">
              {comparison.totalAbsent}
            </strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#5C5E64] font-mono tabular-nums">
          <span>{comparison.totalSessions} sesi tercatat</span>
          <span>
            Kehadiran{' '}
            <strong className="font-semibold text-[#1F7A5A]">
              {comparison.overallAttendanceRate}%
            </strong>
          </span>
          {comparison.totalAbsent > 0 && (
            <span>
              Izin {comparison.totalIzin} · Sakit {comparison.totalSakit} · Alpa {comparison.totalAlpa}
            </span>
          )}
          {selectedClass && onSelectClass && (
            <button
              type="button"
              onClick={() => onSelectClass('')}
              className="font-sans font-medium text-[#222B3A] underline underline-offset-2 hover:text-[#E56B63] cursor-pointer"
            >
              Hapus filter {selectedClass}
            </button>
          )}
        </div>
      </div>

      {/* Recharts Bar Chart Viewport */}
      {comparison.totalSessions === 0 || chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <p className="font-serif text-sm font-semibold text-[#1E2433]">
            Belum ada data absensi sesi literasi untuk ditampilkan
          </p>
          <p className="mt-1 max-w-md text-xs text-[#5C5E64]">
            Gunakan tombol &ldquo;Catat Sesi &amp; Absen&rdquo; pada jadwal kelas untuk merekam daftar siswa hadir dan tidak hadir agar grafik perbandingan muncul di sini.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div
            className={cn(
              'h-[280px] sm:h-[310px] w-full min-w-0',
              chartData.length > 6 && 'min-w-[520px] sm:min-w-0'
            )}
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
                barGap={layoutMode === 'grouped' ? 4 : 0}
                barCategoryGap={chartData.length <= 4 ? '32%' : '20%'}
              >
                <CartesianGrid
                  stroke="#E7E4DC"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortLabel"
                  axisLine={{ stroke: '#DFDCD2' }}
                  tickLine={false}
                  interval={0}
                  tick={{
                    fill: '#4A4945',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono), ui-monospace, monospace',
                  }}
                  dy={6}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: '#7B7D82',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono), ui-monospace, monospace',
                  }}
                />
                <Tooltip
                  content={<AttendanceTooltip />}
                  cursor={{ fill: 'rgba(235, 232, 223, 0.65)' }}
                />
                <Bar
                  dataKey="presentCount"
                  name="Hadir"
                  stackId={layoutMode === 'stacked' ? 'attendance' : undefined}
                  radius={layoutMode === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                  onClick={(barData) =>
                    handleBarSelect(barData?.payload as ClassAttendanceComparisonEntry | undefined)
                  }
                  className={onSelectClass ? 'cursor-pointer' : undefined}
                >
                  {chartData.map((entry) => {
                    const isDimmed = Boolean(selectedClass && selectedClass !== entry.className);
                    return (
                      <Cell
                        key={`present-${entry.className}`}
                        fill={isDimmed ? COLOR_PRESENT_DIM : COLOR_PRESENT}
                      />
                    );
                  })}
                </Bar>
                <Bar
                  dataKey="absentCount"
                  name="Tidak Hadir"
                  stackId={layoutMode === 'stacked' ? 'attendance' : undefined}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  isAnimationActive={false}
                  onClick={(barData) =>
                    handleBarSelect(barData?.payload as ClassAttendanceComparisonEntry | undefined)
                  }
                  className={onSelectClass ? 'cursor-pointer' : undefined}
                >
                  {chartData.map((entry) => {
                    const isDimmed = Boolean(selectedClass && selectedClass !== entry.className);
                    return (
                      <Cell
                        key={`absent-${entry.className}`}
                        fill={isDimmed ? COLOR_ABSENT_DIM : COLOR_ABSENT}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
