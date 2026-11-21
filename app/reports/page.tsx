'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Download,
  FileText,
  GraduationCap,
  Printer,
  RotateCcw,
  Tag,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
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
  REPORT_TYPES,
  buildReportExportMeta,
  doesReportSupportCategoryFilter,
  extractCityFromAddress,
  formatIndonesianDate,
  formatPdfCellValue,
  formatReportColumnLabel,
  formatRupiahPlain,
  getReportCategoryFilterHint,
  getReportClassFilterHint,
  getReportColumnAlignment,
  isCirculationReportType,
  isNumericColumn,
  type CirculationCategoryBreakdownItem,
  type CirculationSummaryStats,
  type PdfReportSummaryMetric,
} from '@/lib/domain/report-filters';
import { cn } from '@/lib/utils';

interface SchoolClassOption {
  className: string;
  gradeLevel: number;
  homeroomTeacher: string;
  companionTeacher: string;
  roomLabel: string;
}

function ReportsPageContent() {
  const searchParams = useSearchParams();
  const { user, library, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadReports = can('reports.read');

  const initialTypeParam = searchParams.get('type');
  const initialClassParam = searchParams.get('className');
  const initialCategoryParam = searchParams.get('categoryId');

  const [reportType, setReportType] = useState(() =>
    initialTypeParam && REPORT_TYPES.some((rt) => rt.value === initialTypeParam)
      ? initialTypeParam
      : 'circulation'
  );
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState('2026-12-31');
  const [categoryId, setCategoryId] = useState(() => (initialCategoryParam || '').trim());
  const [className, setClassName] = useState(() => (initialClassParam || '').trim());
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [schoolClasses, setSchoolClasses] = useState<SchoolClassOption[]>([]);
  const [otherUnits, setOtherUnits] = useState<string[]>([]);
  const [selectedCategoryNameApi, setSelectedCategoryNameApi] = useState('');
  const [circulationSummary, setCirculationSummary] = useState<CirculationSummaryStats | null>(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CirculationCategoryBreakdownItem[]>([]);
  const [filterHint, setFilterHint] = useState('');
  const [settledKey, setSettledKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supportsCategory = doesReportSupportCategoryFilter(reportType);
  const isCirculation = isCirculationReportType(reportType);
  const effectiveCategoryId = supportsCategory ? categoryId : '';

  const requestKey = `${reportType}|${fromDate}|${toDate}|${effectiveCategoryId}|${className}|${reloadNonce}`;
  const loading = Boolean(authLoading || (user && canReadReports && settledKey !== requestKey));

  const retryLoad = useCallback(() => {
    setError(null);
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (authLoading || !user || !canReadReports) return;
    let active = true;
    const sp = new URLSearchParams({
      type: reportType,
      fromDate,
      toDate,
    });
    if (effectiveCategoryId) sp.set('categoryId', effectiveCategoryId);
    if (className) sp.set('className', className);
    gatewayFetch(`/api/reports?${sp.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat laporan.');
        if (active) {
          setRows(data.rows || []);
          setCategories(data.categories || []);
          if (Array.isArray(data.schoolClasses)) setSchoolClasses(data.schoolClasses);
          if (Array.isArray(data.otherUnits)) setOtherUnits(data.otherUnits);
          setSelectedCategoryNameApi(
            typeof data.selectedCategoryName === 'string' ? data.selectedCategoryName : ''
          );
          setCirculationSummary(data.circulationSummary || null);
          setCategoryBreakdown(Array.isArray(data.categoryBreakdown) ? data.categoryBreakdown : []);
          setFilterHint(typeof data.filterHint === 'string' ? data.filterHint : '');
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat laporan.');
      })
      .finally(() => {
        if (active) setSettledKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [
    authLoading,
    user,
    canReadReports,
    reportType,
    fromDate,
    toDate,
    effectiveCategoryId,
    className,
    requestKey,
  ]);

  const currentLabel = REPORT_TYPES.find((r) => r.value === reportType)?.label || 'Laporan';

  const selectedCategoryName = useMemo(() => {
    if (!effectiveCategoryId) return '';
    const match = categories.find((c) => String(c.id) === effectiveCategoryId);
    return match?.name || selectedCategoryNameApi || '';
  }, [categories, effectiveCategoryId, selectedCategoryNameApi]);

  const exportMeta = useMemo(
    () =>
      buildReportExportMeta({
        reportType,
        reportLabel: currentLabel,
        className,
        categoryName: selectedCategoryName,
      }),
    [reportType, currentLabel, className, selectedCategoryName]
  );

  const selectedClassMeta = useMemo(
    () =>
      schoolClasses.find(
        (c) => c.className.trim().toLowerCase() === className.trim().toLowerCase()
      ) || null,
    [schoolClasses, className]
  );

  const activeHint = useMemo(() => {
    if (filterHint) return filterHint;
    return [
      getReportCategoryFilterHint(reportType, selectedCategoryName),
      getReportClassFilterHint(reportType, className),
    ]
      .filter(Boolean)
      .join(' ');
  }, [filterHint, reportType, selectedCategoryName, className]);

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const hasSecondaryFilters = Boolean(className || effectiveCategoryId);

  const totalBreakdownItems = useMemo(
    () => categoryBreakdown.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [categoryBreakdown]
  );

  const pdfSummaryMetrics = useMemo<PdfReportSummaryMetric[]>(() => {
    if (!isCirculation || !circulationSummary) return [];
    return [
      { label: 'Total Sirkulasi', value: `${circulationSummary.totalItems} item`, tone: 'neutral' },
      { label: 'Sedang Dipinjam', value: `${circulationSummary.borrowed}`, tone: 'accent' },
      { label: 'Dikembalikan', value: `${circulationSummary.returned}`, tone: 'success' },
      {
        label: 'Terlambat',
        value: `${circulationSummary.overdue}`,
        tone: circulationSummary.overdue > 0 ? 'danger' : 'neutral',
      },
      {
        label: 'Total Denda',
        value: formatRupiahPlain(circulationSummary.totalFine),
        tone: circulationSummary.totalFine > 0 ? 'warning' : 'neutral',
      },
    ];
  }, [isCirculation, circulationSummary]);

  const institutionInitials = useMemo(() => {
    return (
      (library.name || 'Lentera Pustaka')
        .split(/\s+/)
        .filter((w) => w.length > 0 && !/^(sd|sdn|perpustakaan|sekolah|dasar)$/i.test(w))
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('') || 'LP'
    );
  }, [library.name]);

  const signatureDateLine = useMemo(() => {
    const city = extractCityFromAddress(library.address);
    return `${city}, ${formatIndonesianDate(new Date())}`;
  }, [library.address]);

  const handleExportPdf = useCallback(() => {
    if (rows.length === 0) return;
    try {
      const savedName = exportToPdf(`${exportMeta.baseFilename}.pdf`, exportMeta.title, rows, library, {
        subtitle: activeHint || undefined,
        fromDate,
        toDate,
        categoryName: selectedCategoryName || undefined,
        className: className || undefined,
        summaryMetrics: pdfSummaryMetrics,
      });
      if (savedName) {
        showToast(
          'success',
          'Laporan PDF berhasil diekspor',
          `${savedName} (${rows.length} baris${selectedCategoryName ? ` · Kategori ${selectedCategoryName}` : ''})`
        );
      }
    } catch {
      showToast('error', 'Gagal mengekspor PDF', 'Terjadi kendala saat membuat berkas PDF.');
    }
  }, [
    rows,
    exportMeta,
    library,
    activeHint,
    fromDate,
    toDate,
    selectedCategoryName,
    className,
    pdfSummaryMetrics,
    showToast,
  ]);

  const emptyStateTitle = useMemo(() => {
    if (selectedCategoryName && className) {
      return `Tidak ada data kategori ${selectedCategoryName} untuk ${className}`;
    }
    if (selectedCategoryName) {
      return `Tidak ada data sirkulasi untuk kategori ${selectedCategoryName}`;
    }
    if (className) {
      return `Tidak ada data untuk ${className} pada periode ini`;
    }
    return 'Tidak ada data pada periode ini';
  }, [selectedCategoryName, className]);

  const emptyStateDescription = useMemo(() => {
    if (selectedCategoryName || className) {
      return 'Coba pilih kategori buku atau rombel/kelas lain, ubah rentang tanggal, atau klik Reset Filter untuk melihat seluruh data.';
    }
    return 'Coba ubah rentang tanggal atau pilih jenis laporan lain.';
  }, [selectedCategoryName, className]);

  return (
    <AppShell
      title="Laporan & Analitik"
      description="Filter laporan sirkulasi berdasarkan kategori buku dan rombel/kelas, lalu ekspor ke PDF resmi ber-kop instansi perpustakaan."
      requiredPermission="reports.read"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => exportToCsv(`${exportMeta.baseFilename}.csv`, rows)}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => exportToExcel(`${exportMeta.baseFilename}.xlsx`, exportMeta.title, rows)}
          >
            Excel
          </Button>
          <Button variant="secondary" disabled={rows.length === 0} onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          <Button variant="primary" disabled={rows.length === 0} onClick={handleExportPdf}>
            <FileText className="h-4 w-4" />
            Ekspor PDF
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="no-print space-y-4 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField
              label="Jenis Laporan"
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Kategori Buku"
              value={effectiveCategoryId}
              disabled={!supportsCategory}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">
                {supportsCategory ? 'Semua Kategori Buku' : 'Tidak berlaku untuk laporan ini'}
              </option>
              {supportsCategory &&
                categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
            </SelectField>
            <SelectField
              label="Rombel/Kelas"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            >
              <option value="">Semua Rombel/Kelas</option>
              {schoolClasses.length > 0 && (
                <optgroup label={`Rombel Kelas SD (${schoolClasses.length})`}>
                  {schoolClasses.map((c) => (
                    <option key={c.className} value={c.className}>
                      {c.className}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherUnits.length > 0 && (
                <optgroup label="Unit / Kelompok Lainnya">
                  {otherUnits.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </optgroup>
              )}
            </SelectField>
            <TextField
              label="Dari Tanggal"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <TextField
              label="Sampai Tanggal"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          {isCirculation && categoryBreakdown.length > 0 && (
            <div className="border-t border-[#EAE7DF] pt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4A4945]">
                  <BookOpen className="h-3.5 w-3.5 text-[#E56B63]" />
                  Filter Cepat Kategori Buku (Sirkulasi)
                </span>
                <span className="font-mono text-[11px] text-[#7B7D82] tabular-nums">
                  {categoryBreakdown.length} kategori aktif
                </span>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter cepat kategori buku">
                <button
                  type="button"
                  onClick={() => setCategoryId('')}
                  aria-pressed={effectiveCategoryId === ''}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                    effectiveCategoryId === ''
                      ? 'border-[#222B3A] bg-[#222B3A] text-white'
                      : 'border-[#E2DFD7] bg-white text-[#1E2433] hover:bg-[#EFECE3]'
                  )}
                >
                  <span>Semua Kategori</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
                      effectiveCategoryId === ''
                        ? 'bg-white/15 text-white'
                        : 'bg-[#F4F3EE] text-[#5C5E64]'
                    )}
                  >
                    {totalBreakdownItems}
                  </span>
                </button>
                {categoryBreakdown.map((item) => {
                  const idVal = item.categoryId !== null ? String(item.categoryId) : '';
                  if (!idVal) return null;
                  const isActive = effectiveCategoryId === idVal;
                  return (
                    <button
                      key={idVal}
                      type="button"
                      onClick={() => setCategoryId(isActive ? '' : idVal)}
                      aria-pressed={isActive}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                        isActive
                          ? 'border-[#222B3A] bg-[#222B3A] text-white'
                          : 'border-[#E2DFD7] bg-white text-[#1E2433] hover:bg-[#EFECE3]'
                      )}
                    >
                      <span>{item.categoryName}</span>
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
                          isActive ? 'bg-white/15 text-white' : 'bg-[#F4F3EE] text-[#5C5E64]'
                        )}
                      >
                        {item.total}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {hasSecondaryFilters && (
            <div className="flex flex-col gap-2.5 border-t border-[#EAE7DF] pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 text-[#5C5E64]">
                {selectedCategoryName && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#1E2433]">
                    <Tag className="h-3.5 w-3.5 shrink-0 text-[#E56B63]" />
                    <span>
                      Filter Kategori Buku:{' '}
                      <strong className="font-semibold text-[#1E2433]">
                        {selectedCategoryName}
                      </strong>
                    </span>
                  </span>
                )}
                {className && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#1E2433]">
                    <GraduationCap className="h-3.5 w-3.5 shrink-0 text-[#E56B63]" />
                    <span>
                      Filter Rombel/Kelas: <span className="font-mono">{className}</span>
                    </span>
                  </span>
                )}
                {selectedClassMeta?.homeroomTeacher && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 shrink-0 text-[#7B7D82]" />
                    <span>
                      Wali:{' '}
                      <strong className="font-medium text-[#1E2433]">
                        {selectedClassMeta.homeroomTeacher}
                      </strong>
                    </span>
                  </span>
                )}
                {selectedClassMeta?.companionTeacher && (
                  <span className="inline-flex items-center gap-1">
                    <span>
                      Pendamping:{' '}
                      <strong className="font-medium text-[#1E2433]">
                        {selectedClassMeta.companionTeacher}
                      </strong>
                    </span>
                  </span>
                )}
                {activeHint && <span className="text-[#5C5E64]">{activeHint}</span>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start shrink-0 sm:self-center"
                onClick={() => {
                  setClassName('');
                  setCategoryId('');
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Filter
              </Button>
            </div>
          )}
        </div>

        {!loading && !error && isCirculation && circulationSummary && rows.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Total Sirkulasi"
              value={circulationSummary.totalItems}
              hint={selectedCategoryName ? `Kategori ${selectedCategoryName}` : 'Seluruh kategori buku'}
            />
            <StatCard
              label="Sedang Dipinjam"
              value={circulationSummary.borrowed}
              tone="accent"
              hint="Aktif beredar"
            />
            <StatCard
              label="Sudah Dikembalikan"
              value={circulationSummary.returned}
              tone="success"
              hint="Tercatat kembali"
            />
            <StatCard
              label="Terlambat"
              value={circulationSummary.overdue}
              tone={circulationSummary.overdue > 0 ? 'danger' : 'neutral'}
              hint="Melewati jatuh tempo"
            />
            <div className="col-span-2 sm:col-span-1">
              <StatCard
                label="Total Denda"
                value={formatRupiahPlain(circulationSummary.totalFine)}
                tone={circulationSummary.totalFine > 0 ? 'warning' : 'neutral'}
                hint="Akumulasi denda periode"
              />
            </div>
          </div>
        )}

        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={retryLoad} />}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title={emptyStateTitle}
            description={emptyStateDescription}
            action={
              hasSecondaryFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setClassName('');
                    setCategoryId('');
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Filter
                </Button>
              ) : undefined
            }
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
            {/* Formal Institutional Letterhead Preview (mirrors exported PDF Kop Surat) */}
            <div className="bg-[#FAF9F5] px-5 pt-5 pb-4 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#222B3A] font-serif text-base font-bold tracking-wider text-[#FAF9F5] ring-2 ring-inset ring-[#E56B63]/70"
                >
                  {institutionInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#E56B63]">
                    Sistem Informasi Perpustakaan Sekolah
                  </p>
                  <p className="mt-0.5 font-serif text-base font-bold uppercase tracking-wide text-[#1E2433] sm:text-lg">
                    {library.name}
                  </p>
                  {library.tagline && (
                    <p className="font-serif text-xs italic text-[#5C5E64]">{library.tagline}</p>
                  )}
                  <p className="mt-1 text-xs text-[#4A4945]">{library.address}</p>
                  <p className="mt-0.5 text-[11px] text-[#6E6E73]">
                    {[
                      library.npsn ? `NPSN: ${library.npsn}` : '',
                      library.phone ? `Telp: ${library.phone}` : '',
                      library.email ? `Email: ${library.email}` : '',
                      library.website || '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-0.5">
                <div className="h-[2px] w-full bg-[#222B3A]" />
                <div className="h-[1px] w-full bg-[#E56B63]" />
              </div>
            </div>

            {/* Report Title & Structured Filter Metadata Grid */}
            <div className="border-b border-[#E7E4DC] bg-[#F7F6F1] px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                    {exportMeta.title}
                  </h2>
                  {activeHint && <p className="mt-0.5 text-xs text-[#5C5E64]">{activeHint}</p>}
                </div>
                <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
                  {rows.length} baris
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3.5 py-2.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-[#7B7D82]">Periode:</dt>
                  <dd className="font-mono font-medium text-[#1E2433] tabular-nums">
                    {fromDate} s/d {toDate}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-[#7B7D82]">Kategori Buku:</dt>
                  <dd className="font-medium text-[#1E2433]">
                    {selectedCategoryName || 'Semua Kategori Buku'}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-[#7B7D82]">Rombel/Kelas:</dt>
                  <dd className="font-medium text-[#1E2433]">
                    {className || 'Semua Rombel/Kelas'}
                  </dd>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-[#7B7D82]">Tahun Ajaran:</dt>
                  <dd className="font-medium text-[#1E2433]">
                    {library.academicYear || '-'} ({library.semester || '-'})
                  </dd>
                </div>
              </dl>
            </div>

            {/* Report Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#222B3A] text-xs font-medium text-white">
                  <tr>
                    <th className="w-9 px-2.5 py-2.5 text-center whitespace-nowrap">No</th>
                    {columns.map((col) => {
                      const align = getReportColumnAlignment(col);
                      return (
                        <th
                          key={col}
                          className={cn(
                            'px-3 py-2.5 whitespace-nowrap',
                            align === 'right' && 'text-right',
                            align === 'center' && 'text-center'
                          )}
                        >
                          {formatReportColumnLabel(col)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF] bg-white">
                  {rows.map((row, idx) => (
                    <tr key={idx} className="odd:bg-white even:bg-[#FAF9F5]/80 hover:bg-[#F4F3EE]">
                      <td className="px-2.5 py-2.5 text-center font-mono text-xs text-[#7B7D82] tabular-nums whitespace-nowrap">
                        {idx + 1}
                      </td>
                      {columns.map((col) => {
                        const align = getReportColumnAlignment(col);
                        const formatted = formatPdfCellValue(col, row[col]);
                        const isStatusCol = col.trim().toLowerCase() === 'status';
                        const isNumeric = isNumericColumn(col);
                        const shouldNoWrap =
                          isNumeric ||
                          isStatusCol ||
                          align === 'center' ||
                          col.toLowerCase().includes('tanggal') ||
                          col.toLowerCase().includes('tempo') ||
                          col.toLowerCase().includes('kode') ||
                          col.toLowerCase().startsWith('no_');
                        return (
                          <td
                            key={col}
                            className={cn(
                              'px-3 py-2.5 text-xs text-[#1E2433]',
                              isNumeric && 'font-mono tabular-nums',
                              shouldNoWrap && 'whitespace-nowrap',
                              align === 'right' && 'text-right',
                              align === 'center' && 'text-center',
                              col === 'Kategori_Buku' && 'font-medium text-[#222B3A]'
                            )}
                          >
                            {isStatusCol ? (
                              <StatusIndicator status={formatted} />
                            ) : (
                              formatted
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(library.principalName || library.librarianHeadName) && (
              <div className="grid grid-cols-1 gap-6 border-t border-[#E7E4DC] bg-[#FAF9F5] px-6 py-5 text-xs text-[#1E2433] sm:grid-cols-2">
                <div>
                  <p className="text-[#5C5E64]">Mengetahui,</p>
                  <p className="font-medium">Kepala Sekolah</p>
                  <p className="mt-10 font-semibold underline underline-offset-4">
                    {library.principalName || '______________________'}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[#5C5E64]">{signatureDateLine}</p>
                  <p className="font-medium">Kepala Perpustakaan</p>
                  <p className="mt-10 font-semibold underline underline-offset-4">
                    {library.librarianHeadName || '______________________'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <AppShell
          title="Laporan & Analitik"
          description="Filter laporan sirkulasi berdasarkan kategori buku dan rombel/kelas, lalu ekspor ke PDF resmi ber-kop instansi perpustakaan."
          requiredPermission="reports.read"
        >
          <LoadingState rows={6} />
        </AppShell>
      }
    >
      <ReportsPageContent />
    </Suspense>
  );
}
