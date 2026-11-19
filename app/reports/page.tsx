'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SelectField,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { exportToCsv, exportToExcel, exportToPdf } from '@/lib/client/export';

const REPORT_TYPES = [
  { value: 'loans', label: 'Laporan Peminjaman' },
  { value: 'returns', label: 'Laporan Pengembalian' },
  { value: 'overdue', label: 'Laporan Keterlambatan' },
  { value: 'collection', label: 'Laporan Koleksi Buku' },
  { value: 'available', label: 'Laporan Buku Tersedia' },
  { value: 'active_members', label: 'Laporan Anggota Aktif' },
  { value: 'most_active_members', label: 'Laporan Anggota Paling Aktif' },
  { value: 'popular_books', label: 'Laporan Buku Paling Populer' },
  { value: 'popular_categories', label: 'Laporan Kategori Paling Diminati' },
  { value: 'fines', label: 'Laporan Denda' },
  { value: 'payments', label: 'Laporan Pembayaran' },
  { value: 'acquisitions', label: 'Laporan Pengadaan' },
  { value: 'inventory', label: 'Laporan Inventaris' },
  { value: 'lost_damaged', label: 'Laporan Buku Hilang & Rusak' },
];

export default function ReportsPage() {
  const { user, library, loading: authLoading, can } = useAuth();
  const canReadReports = can('reports.read');
  const [reportType, setReportType] = useState('loans');
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState('2026-12-31');
  const [categoryId, setCategoryId] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        type: reportType,
        fromDate,
        toDate,
      });
      if (categoryId) sp.set('categoryId', categoryId);
      const res = await gatewayFetch(`/api/reports?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat laporan.');
      setRows(data.rows || []);
      setCategories(data.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat laporan.');
    } finally {
      setLoading(false);
    }
  }, [reportType, fromDate, toDate, categoryId]);

  useEffect(() => {
    if (authLoading || !user || !canReadReports) return;
    let active = true;
    const sp = new URLSearchParams({
      type: reportType,
      fromDate,
      toDate,
    });
    if (categoryId) sp.set('categoryId', categoryId);
    gatewayFetch(`/api/reports?${sp.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat laporan.');
        if (active) {
          setRows(data.rows || []);
          setCategories(data.categories || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat laporan.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadReports, reportType, fromDate, toDate, categoryId]);

  const currentLabel = REPORT_TYPES.find((r) => r.value === reportType)?.label || 'Laporan';
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <AppShell
      title="Laporan & Analitik"
      description="Laporan operasional real-time dari data transaksi database beserta fitur cetak dan export."
      requiredPermission="reports.read"
      actions={
        <>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => exportToCsv(`laporan-${reportType}.csv`, rows)}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => exportToExcel(`laporan-${reportType}.xlsx`, currentLabel, rows)}
          >
            Excel
          </Button>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => exportToPdf(`laporan-${reportType}.pdf`, currentLabel, rows, library)}
          >
            PDF
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="no-print grid grid-cols-1 gap-4 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-4 sm:grid-cols-4">
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
          <SelectField
            label="Kategori Koleksi"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Semua Kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </div>

        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={loadReport} />}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            title="Tidak ada data pada periode ini"
            description="Coba ubah rentang tanggal atau pilih jenis laporan lain."
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
            <div className="border-b border-[#E7E4DC] bg-[#F7F6F1] px-5 py-4">
              <p className="font-serif text-sm font-bold uppercase tracking-wide text-[#1E2433]">
                {library.name}
              </p>
              <p className="mt-0.5 text-xs text-[#5C5E64]">
                {[
                  library.address,
                  library.npsn ? `NPSN: ${library.npsn}` : '',
                  library.phone ? `Telp: ${library.phone}` : '',
                  library.email,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-0.5 text-[11px] text-[#7B7D82]">
                Tahun Ajaran {library.academicYear || '-'} · Semester {library.semester || '-'} · Periode{' '}
                <span className="font-mono tabular-nums">
                  {fromDate} s/d {toDate}
                </span>
              </p>
            </div>
            <div className="border-b border-[#E7E4DC] px-5 py-3.5 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                {currentLabel}
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {rows.length} baris
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-4 py-3 whitespace-nowrap">
                        {col.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#F4F3EE]/80">
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-4 py-2.5 text-xs text-slate-800 font-mono tabular-nums"
                        >
                          {String(row[col] ?? '-')}
                        </td>
                      ))}
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
                  <p className="text-[#5C5E64]">Penanggung Jawab,</p>
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
