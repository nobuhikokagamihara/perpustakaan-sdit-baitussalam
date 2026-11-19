'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus, QrCode } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  ErrorState,
  LoadingState,
  Modal,
  SelectField,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';

interface LocationRow {
  id: number;
  code: string;
  building: string;
  floor: string;
  room: string;
}

interface ShelfRow {
  id: number;
  location_id: number;
  code: string;
  name: string;
  capacity: number;
  building: string;
  room: string;
  current_count: number;
}

interface CopyRow {
  id: number;
  inventory_code: string;
  barcode: string;
  book_title: string;
  shelf_id: number | null;
  shelf_code: string | null;
  condition: string;
  status: string;
}

interface AuditRow {
  id: number;
  audit_number: string;
  title: string;
  shelf_code: string | null;
  status: string;
  total_expected: number;
  total_scanned: number;
  total_discrepancy: number;
  started_at: string;
}

export default function InventoryPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadInventory = can('inventory.read');
  const [tab, setTab] = useState<'shelves' | 'copies' | 'opname'>('shelves');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [shelves, setShelves] = useState<ShelfRow[]>([]);
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [activeAuditId, setActiveAuditId] = useState<number | null>(null);
  const [auditItems, setAuditItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Forms
  const [shelfOpen, setShelfOpen] = useState(false);
  const [shelfLocId, setShelfLocId] = useState('');
  const [shelfCode, setShelfCode] = useState('');
  const [shelfName, setShelfName] = useState('');
  const [shelfCap, setShelfCap] = useState('150');

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTitle, setAuditTitle] = useState('Stock Opname Harian');
  const [auditShelfId, setAuditShelfId] = useState('');

  const [scanCode, setScanCode] = useState('');
  const [scanPhysicalStatus, setScanPhysicalStatus] = useState('Ditemukan');

  const [transferCopy, setTransferCopy] = useState<CopyRow | null>(null);
  const [targetShelfId, setTargetShelfId] = useState('');
  const [targetCondition, setTargetCondition] = useState('Baik');
  const [targetStatus, setTargetStatus] = useState('Tersedia');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = activeAuditId ? `/api/inventory?auditId=${activeAuditId}` : '/api/inventory';
      const res = await gatewayFetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat inventaris.');
      setLocations(data.locations || []);
      setShelves(data.shelves || []);
      setCopies(data.copies || []);
      setAudits(data.audits || []);
      setAuditItems(data.activeAuditItems || []);
      if (data.locations?.length && !shelfLocId) setShelfLocId(String(data.locations[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat inventaris.');
    } finally {
      setLoading(false);
    }
  }, [activeAuditId, shelfLocId]);

  useEffect(() => {
    if (authLoading || !user || !canReadInventory) return;
    let active = true;
    const url = activeAuditId ? `/api/inventory?auditId=${activeAuditId}` : '/api/inventory';
    gatewayFetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat inventaris.');
        if (active) {
          setLocations(data.locations || []);
          setShelves(data.shelves || []);
          setCopies(data.copies || []);
          setAudits(data.audits || []);
          setAuditItems(data.activeAuditItems || []);
          if (data.locations?.length) {
            setShelfLocId((prev) => prev || String(data.locations[0].id));
          }
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat inventaris.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadInventory, activeAuditId]);

  async function handleCreateShelf(e: React.FormEvent) {
    e.preventDefault();
    const res = await gatewayFetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_shelf',
        locationId: Number(shelfLocId),
        code: shelfCode,
        name: shelfName,
        capacity: Number(shelfCap),
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast('error', 'Gagal', d.error);
      return;
    }
    showToast('success', 'Rak ditambahkan', shelfCode);
    setShelfOpen(false);
    setShelfCode('');
    setShelfName('');
    loadData();
  }

  async function handleStartAudit(e: React.FormEvent) {
    e.preventDefault();
    const res = await gatewayFetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start_audit',
        title: auditTitle,
        shelfId: auditShelfId ? Number(auditShelfId) : null,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast('error', 'Gagal', d.error);
      return;
    }
    showToast('success', 'Sesi Stock Opname dimulai', d.auditNumber);
    setAuditOpen(false);
    setActiveAuditId(d.id);
    setTab('opname');
  }

  async function handleScanItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAuditId || !scanCode.trim()) return;
    const res = await gatewayFetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'scan_audit_item',
        auditId: activeAuditId,
        code: scanCode.trim(),
        physicalStatus: scanPhysicalStatus,
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast('error', 'Scan gagal', d.error);
      return;
    }
    showToast('success', 'Eksemplar tercatat', d.inventoryCode);
    setScanCode('');
    loadData();
  }

  async function handleCompleteAudit(auditId: number) {
    try {
      const res = await gatewayFetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete_audit', auditId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal menyelesaikan opname', d.error || 'Terjadi kesalahan.');
        return;
      }
      showToast(
        'success',
        'Stock Opname Selesai',
        `Selisih terdeteksi: ${d.discrepancy.totalDiscrepancy} eksemplar`
      );
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  async function handleUpdateCopy(e: React.FormEvent) {
    e.preventDefault();
    if (!transferCopy) return;
    try {
      const res = await gatewayFetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transfer_copy',
          copyId: transferCopy.id,
          shelfId: targetShelfId ? Number(targetShelfId) : null,
          condition: targetCondition,
          status: targetStatus,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal memperbarui eksemplar', d.error || 'Permintaan ditolak.');
        return;
      }
      showToast('success', 'Inventaris diperbarui', transferCopy.inventory_code);
      setTransferCopy(null);
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  return (
    <AppShell
      title="Inventaris, Lokasi Rak & Stock Opname"
      description="Kelola gedung, rak, pemindahan lokasi eksemplar, pencatatan rusak/hilang, serta audit fisik stock opname."
      requiredPermission="inventory.read"
      actions={
        <>
          <Button variant="secondary" onClick={() => setShelfOpen(true)}>
            <Plus className="h-4 w-4" />
            Tambah Rak
          </Button>
          <Button onClick={() => setAuditOpen(true)}>
            <ClipboardCheck className="h-4 w-4" />
            Mulai Stock Opname
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="inline-flex rounded-lg bg-slate-100 p-1">
          {[
            { id: 'shelves' as const, label: `Gedung & Rak (${shelves.length})` },
            { id: 'copies' as const, label: `Daftar Eksemplar (${copies.length})` },
            { id: 'opname' as const, label: `Stock Opname (${audits.length})` },
          ].map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative rounded-md px-4 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="inventory-tab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-md bg-[#FAF9F5] shadow-sm"
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>

        {loading && <LoadingState rows={5} />}
        {error && <ErrorState message={error} onRetry={loadData} />}

        <AnimatePresence mode="wait" initial={false}>
          {!loading && !error && tab === 'shelves' && (
            <motion.div
              key="shelves"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              {shelves.map((s, idx) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: MOTION_DURATION.normal,
                    delay: getStaggerDelay(idx),
                    ease: EASE_EDITORIAL,
                  }}
                  whileHover={{ y: -2 }}
                  className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#E56B63]">{s.code}</span>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {s.current_count} / {s.capacity}
                    </span>
                  </div>
                  <h3 className="mt-2 font-serif text-base font-semibold text-slate-900">{s.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {s.building} · {s.room}
                  </p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded bg-slate-100">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: MOTION_DURATION.spread, delay: getStaggerDelay(idx), ease: EASE_EDITORIAL }}
                      className="h-full origin-left bg-[#222B3A]"
                      style={{ width: `${Math.min(100, Math.round((s.current_count / Math.max(1, s.capacity)) * 100))}%` }}
                    />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {!loading && !error && tab === 'copies' && (
            <motion.div
              key="copies"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
              className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Kode Inventaris</th>
                      <th className="px-4 py-3">Judul Buku</th>
                      <th className="px-4 py-3">Rak</th>
                      <th className="px-4 py-3">Kondisi</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {copies.map((c) => (
                      <tr key={c.id} className="hover:bg-[#F4F3EE]/80">
                        <td className="px-4 py-2.5 font-mono text-xs">
                          <p className="font-semibold text-slate-900">{c.inventory_code}</p>
                          <p className="text-[11px] text-slate-500">{c.barcode}</p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-900">{c.book_title}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          {c.shelf_code || '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusIndicator status={c.condition} />
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusIndicator status={c.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setTransferCopy(c);
                              setTargetShelfId(c.shelf_id ? String(c.shelf_id) : '');
                              setTargetCondition(c.condition);
                              setTargetStatus(c.status);
                            }}
                          >
                            Pindah / Ubah
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {!loading && !error && tab === 'opname' && (
            <motion.div
              key="opname"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
              className="space-y-6"
            >
            <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">No. Opname</th>
                    <th className="px-4 py-3">Judul Sesi</th>
                    <th className="px-4 py-3">Rak</th>
                    <th className="px-4 py-3 text-right">Terpindai / Target</th>
                    <th className="px-4 py-3 text-right">Selisih</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {audits.map((a) => (
                    <tr key={a.id} className="hover:bg-[#F4F3EE]/80">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                        {a.audit_number}
                      </td>
                      <td className="px-4 py-3 text-slate-900">{a.title}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {a.shelf_code || 'Semua Rak'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {a.total_scanned} / {a.total_expected}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-amber-700 tabular-nums">
                        {a.total_discrepancy}
                      </td>
                      <td className="px-4 py-3">
                        <StatusIndicator status={a.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setActiveAuditId(a.id)}
                          >
                            Buka
                          </Button>
                          {a.status === 'Berlangsung' && (
                            <Button size="sm" onClick={() => handleCompleteAudit(a.id)}>
                              Selesaikan
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activeAuditId && (
              <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 space-y-4">
                <h3 className="font-serif text-base font-semibold text-slate-900">
                  Pemindaian Fisik Stock Opname (#{activeAuditId})
                </h3>
                <form onSubmit={handleScanItem} className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    placeholder="Scan barcode atau ketik kode inventaris (contoh: LP-2026-0001)"
                    aria-label="Kode eksemplar untuk stock opname"
                    className="h-10 flex-1 min-w-[240px] rounded-lg border border-[#E7E4DC] px-3 text-sm"
                  />
                  <select
                    aria-label="Status fisik hasil pemeriksaan"
                    value={scanPhysicalStatus}
                    onChange={(e) => setScanPhysicalStatus(e.target.value)}
                    className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
                  >
                    <option value="Ditemukan">Ditemukan</option>
                    <option value="Rusak">Rusak</option>
                    <option value="Salah Rak">Salah Rak</option>
                    <option value="Tidak Ditemukan">Tidak Ditemukan</option>
                  </select>
                  <Button type="submit">
                    <QrCode className="h-4 w-4" />
                    Catat Scan
                  </Button>
                </form>

                {auditItems.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Kode Inventaris</th>
                          <th className="px-3 py-2">Judul Buku</th>
                          <th className="px-3 py-2">Status Sistem</th>
                          <th className="px-3 py-2 text-right">Hasil Fisik</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAE7DF]">
                        {auditItems.map((it) => (
                          <tr key={String(it.id)}>
                            <td className="px-3 py-2 font-mono">{String(it.inventory_code)}</td>
                            <td className="px-3 py-2">{String(it.book_title)}</td>
                            <td className="px-3 py-2">
                              <StatusIndicator status={String(it.expected_status)} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <StatusIndicator status={String(it.physical_status)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Shelf Modal */}
      <Modal open={shelfOpen} onClose={() => setShelfOpen(false)} title="Tambah Rak Baru" maxWidth="max-w-md">
        <form onSubmit={handleCreateShelf} className="space-y-4">
          <SelectField label="Lokasi Gedung & Ruang" value={shelfLocId} onChange={(e) => setShelfLocId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.building} — {l.room} ({l.floor})
              </option>
            ))}
          </SelectField>
          <TextField label="Kode Rak *" value={shelfCode} onChange={(e) => setShelfCode(e.target.value)} placeholder="R-KOM-01" required />
          <TextField label="Nama Rak *" value={shelfName} onChange={(e) => setShelfName(e.target.value)} placeholder="Rak Komik Edukasi & Cerita" required />
          <TextField label="Kapasitas Eksemplar" type="number" value={shelfCap} onChange={(e) => setShelfCap(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setShelfOpen(false)}>Batal</Button>
            <Button type="submit">Simpan Rak</Button>
          </div>
        </form>
      </Modal>

      {/* Start Audit Modal */}
      <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="Mulai Sesi Stock Opname" maxWidth="max-w-md">
        <form onSubmit={handleStartAudit} className="space-y-4">
          <TextField label="Judul Sesi Opname *" value={auditTitle} onChange={(e) => setAuditTitle(e.target.value)} required />
          <SelectField label="Cakupan Rak" value={auditShelfId} onChange={(e) => setAuditShelfId(e.target.value)}>
            <option value="">Seluruh Rak Perpustakaan</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAuditOpen(false)}>Batal</Button>
            <Button type="submit">Mulai Opname</Button>
          </div>
        </form>
      </Modal>

      {/* Transfer / Update Copy Modal */}
      <Modal open={Boolean(transferCopy)} onClose={() => setTransferCopy(null)} title={`Perbarui Eksemplar · ${transferCopy?.inventory_code}`} maxWidth="max-w-md">
        <form onSubmit={handleUpdateCopy} className="space-y-4">
          <SelectField label="Lokasi Rak" value={targetShelfId} onChange={(e) => setTargetShelfId(e.target.value)}>
            <option value="">Tanpa Rak</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </SelectField>
          <SelectField label="Kondisi Fisik" value={targetCondition} onChange={(e) => setTargetCondition(e.target.value)}>
            <option value="Baik">Baik</option>
            <option value="Rusak Ringan">Rusak Ringan</option>
            <option value="Rusak Berat">Rusak Berat</option>
            <option value="Hilang">Hilang</option>
          </SelectField>
          <SelectField
            label="Status Koleksi"
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value)}
            disabled={
              transferCopy?.status === 'Dipinjam' || transferCopy?.status === 'Direservasi'
            }
          >
            {(transferCopy?.status === 'Dipinjam' || transferCopy?.status === 'Direservasi') && (
              <option value={transferCopy.status}>
                {transferCopy.status} (Dikelola Sirkulasi)
              </option>
            )}
            <option value="Tersedia">Tersedia</option>
            <option value="Perbaikan">Perbaikan</option>
            <option value="Hilang">Hilang</option>
            <option value="Dihapus">Dihapus (Penghapusan Resmi)</option>
          </SelectField>
          {(transferCopy?.status === 'Dipinjam' || transferCopy?.status === 'Direservasi') && (
            <p className="text-xs text-amber-700">
              Status eksemplar sedang aktif di sirkulasi. Anda tetap dapat memindahkan lokasi rak atau memperbarui catatan kondisi.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setTransferCopy(null)}>Batal</Button>
            <Button type="submit">Simpan Perubahan</Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
