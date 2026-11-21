'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  History,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  Modal,
  SelectField,
  StatCard,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import {
  CORE_BACKUP_MODULES,
  PRESERVED_SYSTEM_ITEMS,
  PURGE_CONFIRMATION_PHRASE,
  formatBytes,
  type BackupModuleId,
} from '@/lib/domain/settings-backup-rules';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { exportToExcel } from '@/lib/client/export';
import type {
  BackupMetaPayload,
  BackupSnapshotItem,
  RestoreVerifyResult,
} from './types';

interface BackupCenterTabProps {
  canWrite: boolean;
  currentUserRoleSlug?: string;
  onSystemMutated: () => Promise<void>;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Harian (Ambang 2 hari)',
  weekly: 'Mingguan (Ambang 8 hari)',
  monthly: 'Bulanan (Ambang 32 hari)',
  manual: 'Manual (Ambang 14 hari)',
};

export function BackupCenterTab({
  canWrite,
  currentUserRoleSlug,
  onSystemMutated,
  notify,
}: BackupCenterTabProps) {
  const isSuperAdmin = canWrite && currentUserRoleSlug === 'super_admin';
  const [meta, setMeta] = useState<BackupMetaPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Backup creation controls
  const [backupScope, setBackupScope] = useState<'full' | 'selective'>('full');
  const [selectedModules, setSelectedModules] = useState<BackupModuleId[]>(CORE_BACKUP_MODULES);
  const [includeAudit, setIncludeAudit] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [snapshotNotes, setSnapshotNotes] = useState('');
  const [saveWhileDownload, setSaveWhileDownload] = useState(true);
  const [creatingSnap, setCreatingSnap] = useState(false);
  const [downloadingLive, setDownloadingLive] = useState(false);

  // Restore verification & modal state
  const [restoreSource, setRestoreSource] = useState<{
    type: 'upload' | 'snapshot';
    payload?: Record<string, unknown>;
    snapshotId?: number;
    filename?: string;
  } | null>(null);
  const [verifyResult, setVerifyResult] = useState<RestoreVerifyResult | null>(null);
  const [restoreModules, setRestoreModules] = useState<BackupModuleId[]>([]);
  const [createSafetyBeforeRestore, setCreateSafetyBeforeRestore] = useState(true);
  const [confirmWord, setConfirmWord] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Delete snapshot confirmation
  const [deleteTarget, setDeleteTarget] = useState<BackupSnapshotItem | null>(null);
  const [deletingSnap, setDeletingSnap] = useState(false);

  // Purge All Operational Data (Backup-First Guarded Workflow)
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [creatingMandatoryBackup, setCreatingMandatoryBackup] = useState(false);
  const [purgeAcknowledge, setPurgeAcknowledge] = useState(false);
  const [purgeConfirmPhrase, setPurgeConfirmPhrase] = useState('');
  const [purgingAll, setPurgingAll] = useState(false);
  const [lastPurgeResult, setLastPurgeResult] = useState<{
    deletedRowsTotal: number;
    deletedTables: number;
    prerequisiteSnapshotCode: string;
    purgedAt: string;
  } | null>(null);

  // Backup retention & schedule policy
  const [policyForm, setPolicyForm] = useState({
    backup_auto_frequency: 'weekly',
    backup_retention_count: '10',
    backup_include_audit_logs: 'false',
  });
  const [savingPolicy, setSavingPolicy] = useState(false);

  const fetchBackupMeta = useCallback(async () => {
    const res = await gatewayFetch('/api/backup?mode=meta');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Gagal memuat informasi backup.');
    return json as BackupMetaPayload;
  }, []);

  const applyMeta = useCallback((payload: BackupMetaPayload) => {
    setMeta(payload);
    setPolicyForm({
      backup_auto_frequency: payload.policy?.backup_auto_frequency || 'weekly',
      backup_retention_count: payload.policy?.backup_retention_count || '10',
      backup_include_audit_logs: payload.policy?.backup_include_audit_logs || 'false',
    });
    setIncludeAudit(payload.policy?.backup_include_audit_logs === 'true');
  }, []);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchBackupMeta();
      applyMeta(payload);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal memuat pusat backup.', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchBackupMeta, applyMeta, notify]);

  const handleCreateMandatoryBackup = useCallback(async () => {
    setCreatingMandatoryBackup(true);
    try {
      const label = `Backup Penuh Wajib Pra-Hapus · ${new Date().toLocaleDateString('id-ID')}`;
      const createRes = await gatewayFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_snapshot',
          label,
          notes:
            'Backup penuh otomatis sebagai prasyarat wajib sebelum penghapusan seluruh data operasional.',
          modules: CORE_BACKUP_MODULES,
          includeAudit: true,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createJson.error || 'Gagal membuat backup penuh wajib.');
      }
      const snapId = createJson.snapshot?.id;
      const snapCode = createJson.snapshot?.snapshot_code || 'backup-penuh';
      if (snapId) {
        const dlRes = await gatewayFetch(`/api/backup?snapshotId=${snapId}`);
        if (dlRes.ok) {
          const text = await dlRes.text();
          const blob = new Blob([text], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `lentera-pustaka-${String(snapCode).toLowerCase()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
      await loadMeta();
      notify(
        `Backup penuh wajib ${snapCode} berhasil dibuat & diunduh ke perangkat Anda.`,
        'success'
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Gagal membuat backup penuh wajib.',
        'error'
      );
    } finally {
      setCreatingMandatoryBackup(false);
    }
  }, [loadMeta, notify]);

  useEffect(() => {
    let active = true;
    fetchBackupMeta()
      .then((payload) => {
        if (!active) return;
        applyMeta(payload);
      })
      .catch((err) => {
        if (!active) return;
        notify(err instanceof Error ? err.message : 'Gagal memuat pusat backup.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchBackupMeta, applyMeta, notify]);

  const effectiveModules = useMemo<BackupModuleId[]>(() => {
    const base = backupScope === 'full' ? CORE_BACKUP_MODULES : selectedModules;
    const set = new Set<BackupModuleId>(base);
    if (includeAudit) set.add('audit');
    else set.delete('audit');
    return Array.from(set);
  }, [backupScope, selectedModules, includeAudit]);

  const selectedRecordTotal = useMemo(() => {
    if (!meta) return 0;
    return meta.moduleStats
      .filter((m) => effectiveModules.includes(m.id))
      .reduce((sum, m) => sum + m.rowCount, 0);
  }, [meta, effectiveModules]);

  const toggleModule = (modId: BackupModuleId) => {
    if (modId === 'audit') {
      setIncludeAudit((v) => !v);
      return;
    }
    setBackupScope('selective');
    setSelectedModules((prev) => {
      const exists = prev.includes(modId);
      if (exists && prev.length === 1) {
        notify('Minimal satu modul inti harus dipilih untuk cadangan.', 'info');
        return prev;
      }
      return exists ? prev.filter((m) => m !== modId) : [...prev, modId];
    });
  };

  const handleCreateSnapshot = async () => {
    setCreatingSnap(true);
    try {
      const res = await gatewayFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_snapshot',
          label:
            snapshotLabel.trim() ||
            `Snapshot ${backupScope === 'full' ? 'Penuh' : 'Selektif'} ${new Date().toLocaleDateString('id-ID')}`,
          notes: snapshotNotes.trim(),
          modules: effectiveModules,
          includeAudit,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal membuat snapshot.');
      notify(
        `Snapshot "${json.snapshot?.label}" (${json.snapshot?.total_records} rekord) berhasil disimpan dengan SHA-256.`,
        'success'
      );
      setSnapshotLabel('');
      setSnapshotNotes('');
      await loadMeta();
      await onSystemMutated();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal membuat snapshot.', 'error');
    } finally {
      setCreatingSnap(false);
    }
  };

  const handleDownloadLiveJson = async () => {
    setDownloadingLive(true);
    try {
      const params = new URLSearchParams();
      params.set('modules', effectiveModules.join(','));
      if (includeAudit) params.set('includeAudit', '1');
      if (saveWhileDownload) params.set('saveSnapshot', '1');
      if (snapshotLabel.trim()) params.set('label', snapshotLabel.trim());

      const res = await gatewayFetch(`/api/backup?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Gagal mengunduh berkas backup.');
      }
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lentera-pustaka-${backupScope}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify(
        saveWhileDownload
          ? 'Berkas JSON SHA-256 diunduh sekaligus disimpan ke riwayat snapshot server.'
          : 'Berkas JSON cadangan terverifikasi SHA-256 berhasil diunduh.',
        'success'
      );
      if (saveWhileDownload) {
        await loadMeta();
        await onSystemMutated();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mengunduh backup.', 'error');
    } finally {
      setDownloadingLive(false);
    }
  };

  const handleExportSummaryExcel = () => {
    if (!meta) return;
    const rows = meta.moduleStats.flatMap((mod) =>
      mod.tables.map((t) => ({
        Modul: mod.label,
        Tabel: t.table,
        Jumlah_Rekord: t.count,
        Status_Pilihan: effectiveModules.includes(mod.id) ? 'Dipilih' : 'Tidak Dipilih',
      }))
    );
    exportToExcel(
      `ringkasan-database-lentera-pustaka-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'Inventaris Tabel',
      rows
    );
    notify('Ringkasan inventaris tabel database berhasil diunduh sebagai Excel.', 'success');
  };

  const handleDownloadSnapshot = async (snap: BackupSnapshotItem) => {
    try {
      const res = await gatewayFetch(`/api/backup?snapshotId=${snap.id}&download=1`);
      if (!res.ok) throw new Error('Gagal mengunduh snapshot.');
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lentera-pustaka-${snap.snapshot_code.toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify(`Snapshot ${snap.snapshot_code} berhasil diunduh.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mengunduh snapshot.', 'error');
    }
  };

  const runVerify = async (source: {
    type: 'upload' | 'snapshot';
    payload?: Record<string, unknown>;
    snapshotId?: number;
    filename?: string;
  }) => {
    setVerifying(true);
    try {
      const res = await gatewayFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          source.type === 'snapshot'
            ? { action: 'verify', snapshotId: source.snapshotId }
            : { action: 'verify', backup: source.payload }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verifikasi cadangan gagal.');
      const result = json as RestoreVerifyResult;
      setRestoreSource(source);
      setVerifyResult(result);
      setRestoreModules(result.summary.selectedModules || []);
      setCreateSafetyBeforeRestore(true);
      setConfirmWord('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal memverifikasi berkas cadangan.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      await runVerify({ type: 'upload', payload: parsed, filename: file.name });
    } catch {
      notify('Berkas tidak dapat dibaca sebagai JSON yang valid.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreSource || !verifyResult) return;
    if (restoreModules.length === 0) {
      notify('Pilih minimal satu modul untuk dipulihkan.', 'error');
      return;
    }
    setRestoring(true);
    try {
      const res = await gatewayFetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          ...(restoreSource.type === 'snapshot'
            ? { snapshotId: restoreSource.snapshotId }
            : { backup: restoreSource.payload }),
          selectedModules: restoreModules,
          createSafetySnapshot: createSafetyBeforeRestore,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Pemulihan database gagal.');
      notify(
        json.safetySnapshotCode
          ? `Restore berhasil (${json.restoredRows} rekord dipulihkan). Snapshot pengaman ${json.safetySnapshotCode} tersimpan.`
          : `Restore berhasil (${json.restoredRows} rekord pada ${json.restoredTables} tabel).`,
        'success'
      );
      setVerifyResult(null);
      setRestoreSource(null);
      await loadMeta();
      await onSystemMutated();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menjalankan pemulihan.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const handleDeleteSnapshot = async () => {
    if (!deleteTarget) return;
    setDeletingSnap(true);
    try {
      const res = await gatewayFetch(`/api/backup?snapshotId=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus snapshot.');
      notify(`Snapshot ${deleteTarget.snapshot_code} telah dihapus.`, 'success');
      setDeleteTarget(null);
      await loadMeta();
      await onSystemMutated();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menghapus snapshot.', 'error');
    } finally {
      setDeletingSnap(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'general',
          settings: policyForm,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan kebijakan backup.');
      notify('Kebijakan jadwal dan retensi backup berhasil disimpan.', 'success');
      await loadMeta();
      await onSystemMutated();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan kebijakan backup.', 'error');
    } finally {
      setSavingPolicy(false);
    }
  };

  const copyChecksum = (hash: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(hash).catch(() => {});
      notify('Checksum SHA-256 disalin ke papan klip.', 'info');
    }
  };

  if (loading && !meta) {
    return <LoadingState rows={6} />;
  }

  const healthTone =
    meta?.health.status === 'Sehat'
      ? 'success'
      : meta?.health.status === 'Perlu Backup'
        ? 'warning'
        : 'danger';

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      {meta && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Kesehatan Cadangan"
            value={meta.health.status}
            hint={
              meta.health.daysSinceLast !== null
                ? `Terakhir ${meta.health.daysSinceLast} hari lalu`
                : 'Belum ada snapshot tersimpan'
            }
            tone={healthTone}
          />
          <StatCard
            label="Total Data Aktif"
            value={meta.totalRecords.toLocaleString('id-ID')}
            hint={`${meta.totalTables} tabel · Mesin ${meta.sourceEngine.toUpperCase()}`}
          />
          <StatCard
            label="Snapshot Tersimpan"
            value={meta.snapshots.length}
            hint={`Batas retensi maks ${meta.policy.backup_retention_count} snapshot`}
          />
          <StatCard
            label="Kebijakan Jadwal"
            value={
              meta.policy.backup_auto_frequency === 'daily'
                ? 'Harian'
                : meta.policy.backup_auto_frequency === 'monthly'
                  ? 'Bulanan'
                  : meta.policy.backup_auto_frequency === 'manual'
                    ? 'Manual'
                    : 'Mingguan'
            }
            hint={`Ambang peringatan ${meta.health.thresholdDays} hari`}
          />
        </div>
      )}

      {/* Health Advisory Banner */}
      {meta && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            meta.health.status === 'Sehat'
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
              : 'border-amber-200 bg-amber-50/70 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {meta.health.status === 'Sehat' ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
            )}
            <span>{meta.health.recommendation}</span>
          </div>
          <Button size="sm" variant="secondary" onClick={loadMeta}>
            <RefreshCw className="h-3.5 w-3.5" />
            Segarkan Statistik
          </Button>
        </div>
      )}

      {/* Main Split: Create Backup / Snapshot + Upload & Verify Restore */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Panel 1: Create Backup & Snapshot */}
        <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 lg:col-span-7">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#E7E4DC] pb-3">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 text-[#222B3A]" />
              <div>
                <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                  Buat Cadangan &amp; Snapshot Terverifikasi SHA-256
                </h2>
                <p className="text-xs text-[#5C5E64]">
                  Mencakup seluruh 34 tabel operasional (termasuk Jadwal Baca &amp; Daftar Siswa SD).
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-[#E2DFD7] bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setBackupScope('full');
                  setSelectedModules(CORE_BACKUP_MODULES);
                }}
                className={`rounded-md px-2.5 py-1 font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  backupScope === 'full' ? 'bg-[#222B3A] text-white' : 'text-[#5C5E64]'
                }`}
              >
                Backup Penuh
              </button>
              <button
                type="button"
                onClick={() => setBackupScope('selective')}
                className={`rounded-md px-2.5 py-1 font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  backupScope === 'selective' ? 'bg-[#222B3A] text-white' : 'text-[#5C5E64]'
                }`}
              >
                Selektif per Modul
              </button>
            </div>
          </div>

          {/* Module Selector Grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(meta?.moduleStats || []).map((mod) => {
              const checked = effectiveModules.includes(mod.id);
              return (
                <label
                  key={mod.id}
                  className={`flex cursor-pointer items-start justify-between gap-2.5 rounded-lg border p-3 transition-colors ${
                    checked
                      ? 'border-[#222B3A]/35 bg-white'
                      : 'border-[#ECE9E1] bg-[#F4F3EE]/50 opacity-80'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canWrite}
                      onChange={() => toggleModule(mod.id)}
                      className="mt-0.5 h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#1E2433]">{mod.label}</div>
                      <p className="mt-0.5 text-[11px] leading-snug text-[#5C5E64]">
                        {mod.description}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                    <div className="font-semibold text-[#1E2433]">
                      {mod.rowCount.toLocaleString('id-ID')}
                    </div>
                    <div className="text-[10px] text-[#7B7D82]">{mod.tableCount} tbl</div>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Label & Notes */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Label Snapshot / Cadangan"
              placeholder="Contoh: Pra-Akhir Semester Ganjil 2026"
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              disabled={!canWrite}
            />
            <TextField
              label="Catatan (Opsional)"
              placeholder="Contoh: Sebelum impor siswa kelas 1 baru"
              value={snapshotNotes}
              onChange={(e) => setSnapshotNotes(e.target.value)}
              disabled={!canWrite}
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C5E64]">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={saveWhileDownload}
                onChange={(e) => setSaveWhileDownload(e.target.checked)}
                className="h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
              />
              Simpan juga ke riwayat snapshot server saat mengunduh JSON
            </label>
            <span className="font-mono tabular-nums text-[#1E2433]">
              Terpilih: {effectiveModules.length} modul · {selectedRecordTotal.toLocaleString('id-ID')}{' '}
              rekord
            </span>
          </div>

          {canWrite && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E7E4DC] pt-4">
              <Button loading={creatingSnap} onClick={handleCreateSnapshot}>
                <Archive className="h-4 w-4" />
                Simpan Snapshot Server
              </Button>
              <Button variant="secondary" loading={downloadingLive} onClick={handleDownloadLiveJson}>
                <HardDriveDownload className="h-4 w-4" />
                Unduh JSON (SHA-256)
              </Button>
              <Button variant="secondary" onClick={handleExportSummaryExcel}>
                <FileSpreadsheet className="h-4 w-4" />
                Ringkasan Excel
              </Button>
            </div>
          )}
        </section>

        {/* Panel 2: Upload & Verify Restore + Retention Policy */}
        <div className="space-y-5 lg:col-span-5">
          {/* Upload Restore Card */}
          <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5">
            <div className="mb-3 flex items-center gap-2.5 border-b border-[#E7E4DC] pb-3">
              <RotateCcw className="h-4 w-4 text-[#C94A43]" />
              <div>
                <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                  Pulihkan dari Berkas JSON (Restore)
                </h2>
                <p className="text-xs text-[#5C5E64]">
                  Mendukung format v2 (SHA-256) &amp; v1, pratinjau diff, serta pemulihan selektif.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-[#CFCAC0] bg-white p-4 text-center">
              <Upload className="mx-auto h-6 w-6 text-[#5C5E64]" />
              <p className="mt-2 text-xs font-medium text-[#1E2433]">
                Unggah berkas <code className="font-mono">.json</code> cadangan Lentera Pustaka
              </p>
              <p className="mt-1 text-[11px] text-[#7B7D82]">
                Sistem akan memverifikasi integritas SHA-256 &amp; menampilkan perbandingan data
                sebelum mengubah database.
              </p>
              <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#222B3A] px-4 py-2 text-xs font-medium text-white hover:bg-[#161D28]">
                <Upload className="h-3.5 w-3.5" />
                {verifying ? 'Memverifikasi...' : 'Pilih Berkas Backup (.json)'}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  disabled={!canWrite || verifying}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* Retention & Schedule Policy Card */}
          <form
            onSubmit={handleSavePolicy}
            className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5"
          >
            <div className="mb-3 flex items-center gap-2.5 border-b border-[#E7E4DC] pb-3">
              <Clock className="h-4 w-4 text-[#222B3A]" />
              <div>
                <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                  Kebijakan Jadwal &amp; Retensi Backup
                </h2>
                <p className="text-xs text-[#5C5E64]">
                  Mengatur pengingat kesehatan backup dan jumlah maksimum snapshot yang disimpan.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <SelectField
                label="Frekuensi Target Backup"
                value={policyForm.backup_auto_frequency}
                disabled={!canWrite}
                onChange={(e) =>
                  setPolicyForm((p) => ({ ...p, backup_auto_frequency: e.target.value }))
                }
              >
                {Object.entries(FREQUENCY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </SelectField>

              <TextField
                label="Batas Retensi Snapshot Server (3–50)"
                type="number"
                min={3}
                max={50}
                value={policyForm.backup_retention_count}
                disabled={!canWrite}
                onChange={(e) =>
                  setPolicyForm((p) => ({ ...p, backup_retention_count: e.target.value }))
                }
              />

              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#1E2433]">
                <input
                  type="checkbox"
                  checked={policyForm.backup_include_audit_logs === 'true'}
                  disabled={!canWrite}
                  onChange={(e) =>
                    setPolicyForm((p) => ({
                      ...p,
                      backup_include_audit_logs: e.target.checked ? 'true' : 'false',
                    }))
                  }
                  className="h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                />
                Sertakan tabel <code className="font-mono">audit_logs</code> secara default
              </label>

              {canWrite && (
                <div className="flex justify-end pt-1">
                  <Button type="submit" size="sm" loading={savingPolicy}>
                    <Save className="h-3.5 w-3.5" />
                    Simpan Kebijakan Backup
                  </Button>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Section 3: Saved Server Snapshots History */}
      <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E7E4DC] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-[#222B3A]" />
            <div>
              <h2 className="font-serif text-base font-semibold text-[#1E2433]">
                Riwayat Snapshot Tersimpan ({meta?.snapshots.length || 0})
              </h2>
              <p className="text-xs text-[#5C5E64]">
                Unduh berkas arsip, inspeksi perbandingan data, atau pulihkan 1-klik dengan
                pengaman otomatis.
              </p>
            </div>
          </div>
        </div>

        {!meta || meta.snapshots.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Belum ada snapshot tersimpan di server"
              description="Klik 'Simpan Snapshot Server' di atas untuk membuat titik pemulihan pertama yang terverifikasi SHA-256."
              action={
                canWrite ? (
                  <Button size="sm" loading={creatingSnap} onClick={handleCreateSnapshot}>
                    <Archive className="h-3.5 w-3.5" />
                    Buat Snapshot Pertama Sekarang
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                  <th className="px-4 py-3 font-semibold">Kode &amp; Label</th>
                  <th className="px-4 py-3 font-semibold">Cakupan</th>
                  <th className="px-4 py-3 text-right font-semibold">Rekord &amp; Ukuran</th>
                  <th className="px-4 py-3 font-semibold">SHA-256</th>
                  <th className="px-4 py-3 font-semibold">Dibuat</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9E1]">
                {meta.snapshots.map((snap) => (
                  <tr key={snap.id} className="bg-white hover:bg-[#FAF9F5]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-[#222B3A]">
                          {snap.snapshot_code}
                        </span>
                        {snap.is_auto_safety && (
                          <StatusIndicator status="Pengaman" />
                        )}
                      </div>
                      <div className="mt-0.5 font-medium text-[#1E2433]">{snap.label}</div>
                      {snap.notes && (
                        <div className="mt-0.5 text-[11px] text-[#7B7D82]">{snap.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#1E2433]">
                        {snap.mode === 'full' ? 'Penuh' : 'Selektif'} ({snap.modules.length} modul)
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-[#7B7D82]">
                        {snap.modules.join(', ')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      <div className="font-semibold text-[#1E2433]">
                        {snap.total_records.toLocaleString('id-ID')} rekord
                      </div>
                      <div className="text-[11px] text-[#7B7D82]">{formatBytes(snap.size_bytes)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => copyChecksum(snap.checksum)}
                        title="Klik untuk menyalin checksum SHA-256 lengkap"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-[#4A4945] hover:text-[#1E2433] cursor-pointer"
                      >
                        <span>{snap.checksum.slice(0, 12)}…</span>
                        <Copy className="h-3 w-3 text-[#8A8B90]" />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap font-mono text-[11px] text-[#1E2433] tabular-nums">
                        {snap.created_at.slice(0, 19).replace('T', ' ')}
                      </div>
                      <div className="text-[11px] text-[#7B7D82]">{snap.created_by_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDownloadSnapshot(snap)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Unduh
                        </Button>
                        {canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={verifying}
                              onClick={() =>
                                runVerify({ type: 'snapshot', snapshotId: snap.id })
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Pulihkan
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Hapus snapshot ${snap.label}`}
                              title="Hapus snapshot"
                              onClick={() => setDeleteTarget(snap)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-[#C94A43]" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Danger Zone: Purge All Operational Data (Backup-First Prerequisite) */}
      {canWrite && meta && (
        <section
          aria-labelledby="danger-zone-purge-heading"
          className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1]/55 p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#F2C6C3] bg-white text-[#C94A43]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    id="danger-zone-purge-heading"
                    className="text-sm font-semibold text-[#7A231E]"
                  >
                    Zona Berbahaya — Hapus Seluruh Data Operasional
                  </h3>
                  <StatusIndicator
                    status={
                      meta.purgeEligibility?.hasEligibleBackup
                        ? 'Backup Terpenuhi'
                        : 'Wajib Backup Dahulu'
                    }
                  />
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#7A231E]/85">
                  Menghapus seluruh data operasional perpustakaan (katalog buku, eksemplar, anggota,
                  transaksi peminjaman, pengembalian, denda, reservasi, jadwal baca, kelas,
                  pengadaan, stock opname, notifikasi, dan akun non-admin). Sistem mewajibkan{' '}
                  <strong className="font-semibold">backup penuh terverifikasi SHA-256</strong>{' '}
                  yang dibuat maksimal{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {meta.purgeEligibility?.maxAgeMinutes ?? 30} menit
                  </span>{' '}
                  sebelum eksekusi.
                </p>

                {meta.purgeEligibility?.hasEligibleBackup &&
                meta.purgeEligibility.eligibleSnapshot ? (
                  <div className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-[11px] text-emerald-950">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                      Prasyarat Backup Penuh Terpenuhi
                    </span>
                    <span className="font-mono font-semibold text-[#1E2433]">
                      {meta.purgeEligibility.eligibleSnapshot.snapshot_code}
                    </span>
                    <span className="font-mono tabular-nums text-emerald-800">
                      ({meta.purgeEligibility.eligibleSnapshot.total_records.toLocaleString('id-ID')}{' '}
                      rekord · berlaku {meta.purgeEligibility.eligibleSnapshot.expiresInMinutes} menit
                      lagi)
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#E6B3AF] bg-white/90 px-3 py-2 text-[11px] text-[#9E352F]">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {meta.purgeEligibility?.reason ||
                        'Terkunci: Buat dan unduh backup penuh terlebih dahulu sebelum menghapus seluruh data.'}
                    </span>
                  </div>
                )}

                {lastPurgeResult && (
                  <div className="mt-3 rounded-lg border border-[#E7E4DC] bg-white px-3.5 py-2.5 text-xs text-[#1E2433]">
                    <p className="font-semibold text-[#1E2433]">
                      Pembersihan data selesai pada{' '}
                      <span className="font-mono tabular-nums">
                        {lastPurgeResult.purgedAt.slice(0, 19).replace('T', ' ')} UTC
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#5C5E64]">
                      Sebanyak{' '}
                      <span className="font-mono font-semibold tabular-nums text-[#C94A43]">
                        {lastPurgeResult.deletedRowsTotal.toLocaleString('id-ID')}
                      </span>{' '}
                      rekord dihapus dari{' '}
                      <span className="font-mono tabular-nums">{lastPurgeResult.deletedTables}</span>{' '}
                      tabel operasional. Snapshot prasyarat{' '}
                      <code className="font-mono font-semibold text-[#222B3A]">
                        {lastPurgeResult.prerequisiteSnapshotCode}
                      </code>{' '}
                      tetap tersimpan di daftar Riwayat Snapshot di atas untuk pemulihan kapan saja.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 md:flex-col md:items-end">
              {isSuperAdmin ? (
                <>
                  {!meta.purgeEligibility?.hasEligibleBackup && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={creatingMandatoryBackup}
                      onClick={handleCreateMandatoryBackup}
                    >
                      <HardDriveDownload className="h-3.5 w-3.5" />
                      1. Buat &amp; Unduh Backup Penuh Wajib
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPurgeAcknowledge(false);
                      setPurgeConfirmPhrase('');
                      setPurgeModalOpen(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus Seluruh Data…
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-[#E6B3AF] bg-white px-3 py-2 text-[11px] font-medium text-[#9E352F]">
                  Khusus peran Super Admin
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Restore Verification & Diff Preview Modal */}
      <Modal
        open={Boolean(verifyResult)}
        onClose={() => {
          setVerifyResult(null);
          setRestoreSource(null);
        }}
        title="Verifikasi Integritas & Pratinjau Pemulihan (Restore)"
        description="Periksa checksum SHA-256 serta selisih rekord per modul sebelum menimpa data aktif."
        maxWidth="max-w-3xl"
      >
        {verifyResult && (
          <div className="space-y-4">
            {/* Metadata & Checksum Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-950">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <div>
                  <span className="font-semibold">
                    {verifyResult.summary.checksumStatus === 'verified'
                      ? 'Integritas SHA-256 Terverifikasi Valid'
                      : 'Format Cadangan v1 Legacy Tervalidasi'}
                  </span>
                  <div className="text-[11px] text-emerald-800">
                    {verifyResult.summary.label} · Versi {verifyResult.summary.version} · Diekspor{' '}
                    {verifyResult.summary.exportedAt.slice(0, 19).replace('T', ' ')} oleh{' '}
                    {verifyResult.summary.exportedBy}
                  </div>
                </div>
              </div>
              {verifyResult.summary.checksum && (
                <code className="font-mono text-[11px] text-emerald-900">
                  {verifyResult.summary.checksum.slice(0, 16)}…
                </code>
              )}
            </div>

            {/* Module Diff Comparison Table */}
            <div>
              <p className="mb-2 text-xs font-semibold text-[#1E2433]">
                Pilih Modul yang Akan Dipulihkan &amp; Perbandingan Rekord
              </p>
              <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                      <th className="px-3 py-2 font-semibold">Pulihkan</th>
                      <th className="px-3 py-2 font-semibold">Modul</th>
                      <th className="px-3 py-2 text-right font-semibold">Saat Ini</th>
                      <th className="px-3 py-2 text-right font-semibold">Di Backup</th>
                      <th className="px-3 py-2 text-right font-semibold">Selisih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE9E1] bg-white">
                    {verifyResult.diff.map((row) => {
                      const available = row.presentInBackup;
                      const checked = restoreModules.includes(row.moduleId);
                      return (
                        <tr
                          key={row.moduleId}
                          className={available ? '' : 'bg-[#FAF9F5] text-[#8A8B90]'}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              disabled={!available}
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setRestoreModules((prev) => [...prev, row.moduleId]);
                                } else {
                                  setRestoreModules((prev) =>
                                    prev.filter((m) => m !== row.moduleId)
                                  );
                                }
                              }}
                              className="h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {row.label}
                            {!available && (
                              <span className="ml-2 text-[10px] italic">
                                (tidak ada di berkas ini)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {row.currentRows.toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {available ? row.backupRows.toLocaleString('id-ID') : '—'}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                              !available
                                ? 'text-[#8A8B90]'
                                : row.delta > 0
                                  ? 'text-emerald-700'
                                  : row.delta < 0
                                    ? 'text-[#C94A43]'
                                    : 'text-[#5C5E64]'
                            }`}
                          >
                            {!available
                              ? '—'
                              : row.delta > 0
                                ? `+${row.delta}`
                                : String(row.delta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Auto Safety Snapshot Toggle */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E7E4DC] bg-white p-3 text-xs">
              <input
                type="checkbox"
                checked={createSafetyBeforeRestore}
                onChange={(e) => setCreateSafetyBeforeRestore(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
              />
              <div>
                <p className="font-semibold text-[#1E2433]">
                  Buat Snapshot Pengaman Otomatis Sebelum Restore (Sangat Disarankan)
                </p>
                <p className="mt-0.5 text-[11px] text-[#5C5E64]">
                  Menyimpan kondisi database saat ini sebelum ditimpa agar dapat dibatalkan kapan
                  saja dalam 1 klik.
                </p>
              </div>
            </label>

            {/* Typed Confirmation Guard */}
            <div className="rounded-lg border border-[#F2C6C3] bg-[#FDF2F1] p-3.5">
              <p className="text-xs font-semibold text-[#9E352F]">
                Konfirmasi Keamanan Pemulihan
              </p>
              <p className="mt-0.5 text-[11px] text-[#9E352F]">
                Ketik <code className="font-mono font-bold">PULIHKAN</code> untuk mengeksekusi
                restore pada {restoreModules.length} modul terpilih.
              </p>
              <input
                type="text"
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="Ketik PULIHKAN"
                aria-label="Ketik PULIHKAN untuk konfirmasi restore"
                className="mt-2 h-9 w-full rounded-lg border border-[#E6B3AF] bg-white px-3 font-mono text-xs text-[#1E2433] focus:border-[#C94A43] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setVerifyResult(null);
                  setRestoreSource(null);
                }}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                loading={restoring}
                disabled={confirmWord.trim().toUpperCase() !== 'PULIHKAN' || restoreModules.length === 0}
                onClick={handleConfirmRestore}
              >
                <RotateCcw className="h-4 w-4" />
                Eksekusi Pemulihan ({restoreModules.length} Modul)
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Snapshot Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteSnapshot}
        title="Hapus Snapshot Cadangan?"
        message={`Snapshot "${deleteTarget?.label}" (${deleteTarget?.snapshot_code}) akan dihapus dari penyimpanan server. Pastikan Anda telah mengunduh salinan lokal jika masih diperlukan.`}
        confirmLabel="Hapus Snapshot"
        variant="danger"
        loading={deletingSnap}
      />

      {/* Guided Backup-First Purge All Operational Data Modal */}
      <Modal
        open={purgeModalOpen}
        onClose={() => {
          if (!purgingAll && !creatingMandatoryBackup) {
            setPurgeModalOpen(false);
          }
        }}
        title="Hapus Seluruh Data Operasional"
        description="Proses berisiko tinggi dengan pengaman berlapis. Wajib memiliki backup penuh terbaru sebelum konfirmasi aktif."
        maxWidth="max-w-2xl"
      >
        {meta && (
          <div className="space-y-4">
            {/* Step 1: Mandatory Full Backup Prerequisite */}
            <div
              className={`rounded-lg border p-4 ${
                meta.purgeEligibility?.hasEligibleBackup
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : 'border-[#E6B3AF] bg-[#FDF2F1]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  {meta.purgeEligibility?.hasEligibleBackup ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#C94A43]" />
                  )}
                  <div>
                    <p
                      className={`text-xs font-semibold ${
                        meta.purgeEligibility?.hasEligibleBackup
                          ? 'text-emerald-950'
                          : 'text-[#9E352F]'
                      }`}
                    >
                      Langkah 1 (Wajib): Backup Penuh Terverifikasi SHA-256
                    </p>
                    {meta.purgeEligibility?.hasEligibleBackup &&
                    meta.purgeEligibility.eligibleSnapshot ? (
                      <div className="mt-1 space-y-0.5 text-[11px] text-emerald-900">
                        <p>
                          Snapshot{' '}
                          <code className="font-mono font-semibold">
                            {meta.purgeEligibility.eligibleSnapshot.snapshot_code}
                          </code>{' '}
                          · {meta.purgeEligibility.eligibleSnapshot.label} — terverifikasi valid.
                        </p>
                        <p className="font-mono tabular-nums text-emerald-800">
                          {meta.purgeEligibility.eligibleSnapshot.total_records.toLocaleString(
                            'id-ID'
                          )}{' '}
                          rekord · SHA-256{' '}
                          {meta.purgeEligibility.eligibleSnapshot.checksum.slice(0, 14)}… · berlaku{' '}
                          {meta.purgeEligibility.eligibleSnapshot.expiresInMinutes} menit lagi
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-[#9E352F]">
                        {meta.purgeEligibility?.reason ||
                          'Belum ada backup penuh yang memenuhi syarat. Buat dan unduh backup penuh terlebih dahulu untuk membuka tombol hapus.'}
                      </p>
                    )}
                  </div>
                </div>

                <Button
                  size="sm"
                  variant={meta.purgeEligibility?.hasEligibleBackup ? 'secondary' : 'primary'}
                  loading={creatingMandatoryBackup}
                  disabled={purgingAll}
                  onClick={handleCreateMandatoryBackup}
                >
                  <HardDriveDownload className="h-3.5 w-3.5" />
                  {meta.purgeEligibility?.hasEligibleBackup
                    ? 'Buat Backup Baru & Unduh'
                    : 'Buat & Unduh Backup Penuh'}
                </Button>
              </div>
            </div>

            {/* Step 2: Impact Summary (Deleted vs Preserved) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#F2C6C3] bg-white p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9E352F]">
                  Akan Dihapus Permanen
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-[#C94A43] tabular-nums">
                  {(meta.purgeEligibility?.operationalRecordCount ?? 0).toLocaleString('id-ID')}{' '}
                  <span className="text-xs font-medium text-[#7A231E]">rekord operasional</span>
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-[#5C5E64]">
                  <li>• Katalog buku, eksemplar, kategori, penulis, penerbit, rak</li>
                  <li>• Data anggota, antrean pendaftaran &amp; akun pengguna lain</li>
                  <li>• Transaksi peminjaman, pengembalian, reservasi, denda &amp; bayar</li>
                  <li>• Kelas SD, daftar siswa, jadwal baca &amp; absensi literasi</li>
                  <li>• Pemasok, pengadaan buku, stock opname &amp; notifikasi</li>
                </ul>
              </div>

              <div className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#222B3A]">
                  Tetap Dipertahankan Aman
                </p>
                <ul className="mt-2 space-y-2 text-[11px] text-[#4A4945]">
                  {PRESERVED_SYSTEM_ITEMS.map((item) => (
                    <li key={item.title}>
                      <span className="font-semibold text-[#1E2433]">{item.title}:</span>{' '}
                      {item.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Step 3: Double Confirmation (Locked until Step 1 satisfied) */}
            <div
              className={`space-y-3 rounded-lg border p-4 transition-opacity ${
                meta.purgeEligibility?.hasEligibleBackup
                  ? 'border-[#E6B3AF] bg-[#FDF2F1]/70 opacity-100'
                  : 'border-[#E7E4DC] bg-[#F4F3EE] opacity-60'
              }`}
            >
              <p className="text-xs font-semibold text-[#1E2433]">
                Langkah 2: Konfirmasi Ganda Super Admin
              </p>

              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-[#1E2433]">
                <input
                  type="checkbox"
                  disabled={!meta.purgeEligibility?.hasEligibleBackup || purgingAll}
                  checked={purgeAcknowledge}
                  onChange={(e) => setPurgeAcknowledge(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#CFCAC0] accent-[#C94A43]"
                />
                <span>
                  Saya menyadari seluruh data operasional perpustakaan akan dihapus dan telah
                  memastikan salinan backup penuh terbaru tersedia dengan aman.
                </span>
              </label>

              <div>
                <p className="text-[11px] text-[#7A231E]">
                  Ketik frasa berikut dalam huruf kapital:{' '}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-[#9E352F]">
                    {PURGE_CONFIRMATION_PHRASE}
                  </code>
                </p>
                <input
                  type="text"
                  disabled={!meta.purgeEligibility?.hasEligibleBackup || purgingAll}
                  value={purgeConfirmPhrase}
                  onChange={(e) => setPurgeConfirmPhrase(e.target.value)}
                  placeholder={`Ketik ${PURGE_CONFIRMATION_PHRASE}`}
                  aria-label="Ketik HAPUS SEMUA DATA untuk konfirmasi penghapusan seluruh data"
                  className="mt-1.5 h-9 w-full rounded-lg border border-[#E6B3AF] bg-white px-3 font-mono text-xs text-[#1E2433] focus:border-[#C94A43] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F4F3EE]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E7E4DC] pt-4">
              <Button
                variant="secondary"
                disabled={purgingAll || creatingMandatoryBackup}
                onClick={() => setPurgeModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                loading={purgingAll}
                disabled={
                  !meta.purgeEligibility?.hasEligibleBackup ||
                  !purgeAcknowledge ||
                  purgeConfirmPhrase.trim() !== PURGE_CONFIRMATION_PHRASE ||
                  creatingMandatoryBackup
                }
                onClick={async () => {
                  const snapId = meta.purgeEligibility?.eligibleSnapshot?.id;
                  if (!snapId) return;
                  setPurgingAll(true);
                  try {
                    const res = await gatewayFetch('/api/backup', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'purge_all_data',
                        prerequisiteSnapshotId: snapId,
                        acknowledgeIrreversible: purgeAcknowledge,
                        confirmationPhrase: purgeConfirmPhrase.trim(),
                      }),
                    });
                    const json = await res.json();
                    if (!res.ok) {
                      throw new Error(json.error || 'Gagal menghapus seluruh data operasional.');
                    }
                    setLastPurgeResult({
                      deletedRowsTotal: Number(json.deletedRowsTotal || 0),
                      deletedTables: Number(json.deletedTables || 0),
                      prerequisiteSnapshotCode: String(
                        json.prerequisiteSnapshotCode ||
                          meta.purgeEligibility?.eligibleSnapshot?.snapshot_code ||
                          ''
                      ),
                      purgedAt: String(json.purgedAt || new Date().toISOString()),
                    });
                    setPurgeModalOpen(false);
                    setPurgeAcknowledge(false);
                    setPurgeConfirmPhrase('');
                    await loadMeta();
                    await onSystemMutated();
                    notify(
                      `Seluruh data operasional (${Number(json.deletedRowsTotal || 0).toLocaleString('id-ID')} rekord) berhasil dihapus. Backup prasyarat ${json.prerequisiteSnapshotCode} tetap tersimpan untuk pemulihan.`,
                      'success'
                    );
                  } catch (err) {
                    notify(
                      err instanceof Error
                        ? err.message
                        : 'Gagal menghapus seluruh data operasional.',
                      'error'
                    );
                  } finally {
                    setPurgingAll(false);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Hapus Seluruh Data Sekarang
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
