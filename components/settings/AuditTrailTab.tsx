'use client';

import React, { useMemo, useState } from 'react';
import { Download, Eye, FileSpreadsheet } from 'lucide-react';
import {
  Button,
  EmptyState,
  Modal,
  Pagination,
  SearchField,
} from '@/components/ui/DesignPrimitives';
import { exportToCsv, exportToExcel } from '@/lib/client/export';
import type { AuditLogRow } from './types';

interface AuditTrailTabProps {
  auditLogs: AuditLogRow[];
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const PAGE_SIZE = 20;

function formatPrettyJson(raw?: string | null): string {
  if (!raw) return '— (Tidak ada data)';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditTrailTab({ auditLogs, notify }: AuditTrailTabProps) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [inspectRow, setInspectRow] = useState<AuditLogRow | null>(null);

  const uniqueActions = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.action))).sort(),
    [auditLogs]
  );
  const uniqueEntities = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => l.entity_type))).sort(),
    [auditLogs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (entityFilter !== 'all' && l.entity_type !== entityFilter) return false;
      if (!q) return true;
      return (
        l.user_name.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.entity_type.toLowerCase().includes(q) ||
        l.entity_id.toLowerCase().includes(q) ||
        (l.after_json || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, search, actionFilter, entityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const exportRows = () =>
    filtered.map((l) => ({
      Waktu: l.created_at,
      Petugas: l.user_name,
      Aksi: l.action,
      Entitas: l.entity_type,
      ID_Entitas: l.entity_id,
      Sebelum: l.before_json || '',
      Sesudah: l.after_json || '',
    }));

  const handleExportCsv = () => {
    if (!filtered.length) return;
    exportToCsv(`audit-log-lentera-pustaka-${new Date().toISOString().slice(0, 10)}.csv`, exportRows());
    notify(`Berhasil mengekspor ${filtered.length} baris audit log ke CSV.`, 'success');
  };

  const handleExportExcel = () => {
    if (!filtered.length) return;
    exportToExcel(
      `audit-log-lentera-pustaka-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'Audit Log',
      exportRows()
    );
    notify(`Berhasil mengekspor ${filtered.length} baris audit log ke Excel.`, 'success');
  };

  return (
    <div className="space-y-4">
      {/* Filter & Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchField
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Cari petugas, aksi, entitas, ID..."
            ariaLabel="Cari audit log"
            className="w-64"
          />
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter aksi audit"
            className="h-10 rounded-xl border border-[#E2DFD7] bg-white px-3 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
          >
            <option value="all">Semua Aksi ({uniqueActions.length})</option>
            {uniqueActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter entitas audit"
            className="h-10 rounded-xl border border-[#E2DFD7] bg-white px-3 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
          >
            <option value="all">Semua Entitas</option>
            {uniqueEntities.map((ent) => (
              <option key={ent} value={ent}>
                {ent}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!filtered.length} onClick={handleExportCsv}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!filtered.length}
            onClick={handleExportExcel}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Belum ada catatan audit yang cocok"
          description="Sesuaikan filter pencarian untuk melihat riwayat perubahan data sistem."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                  <th className="px-4 py-3 font-semibold">Waktu</th>
                  <th className="px-4 py-3 font-semibold">Petugas</th>
                  <th className="px-4 py-3 font-semibold">Aksi</th>
                  <th className="px-4 py-3 font-semibold">Entitas &amp; ID</th>
                  <th className="px-4 py-3 text-right font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9E1]">
                {paged.map((l) => (
                  <tr key={l.id} className="bg-white hover:bg-[#FAF9F5]">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[#5C5E64] tabular-nums whitespace-nowrap">
                      {l.created_at}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#1E2433]">{l.user_name}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-[#222B3A]">
                      {l.action}
                    </td>
                    <td className="px-4 py-2.5 text-[#4A4945]">
                      <span>{l.entity_type}</span>{' '}
                      <span className="font-mono text-[11px] text-[#7B7D82]">#{l.entity_id}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setInspectRow(l)}>
                        <Eye className="h-3.5 w-3.5" />
                        Lihat
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* Inspect Before / After Diff Modal */}
      <Modal
        open={Boolean(inspectRow)}
        onClose={() => setInspectRow(null)}
        title={`Detail Jejak Audit — ${inspectRow?.action || ''}`}
        description={
          inspectRow
            ? `${inspectRow.user_name} · ${inspectRow.entity_type} #${inspectRow.entity_id} · ${inspectRow.created_at}`
            : ''
        }
        maxWidth="max-w-3xl"
      >
        {inspectRow && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#5C5E64]">Keadaan Sebelum (Before)</p>
              <pre className="max-h-72 overflow-auto rounded-lg border border-[#E7E4DC] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#1E2433]">
                {formatPrettyJson(inspectRow.before_json)}
              </pre>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#5C5E64]">Keadaan Sesudah (After)</p>
              <pre className="max-h-72 overflow-auto rounded-lg border border-[#E7E4DC] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#1E2433]">
                {formatPrettyJson(inspectRow.after_json)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
