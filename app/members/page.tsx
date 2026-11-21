'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Ban,
  CalendarPlus,
  CreditCard,
  Download,
  Edit3,
  Eye,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Upload,
  UserX,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  QrCodeImage,
  SearchField,
  SelectField,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { exportToCsv, exportToExcel, parseSpreadsheetFile } from '@/lib/client/export';
import { formatCurrencyIDR } from '@/lib/domain/library-rules';

interface MemberRow {
  id: number;
  member_code: string;
  full_name: string;
  membership_type_id: number;
  membership_type_name: string;
  identity_number: string;
  gender: string;
  unit_or_class: string;
  address: string;
  phone: string;
  email: string;
  registered_at: string;
  expires_at: string;
  status: string;
  block_reason: string;
  archived_at?: string | null;
  active_loans_count: number;
  max_loans: number;
  unpaid_fines_total: number;
}

export default function MembersPage() {
  const { user, library, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadMembers = can('members.read');
  const canWriteMembers = can('members.write');
  const canBlockMembers = can('members.block');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [types, setTypes] = useState<Array<{ id: number; name: string }>>([]);
  const [schoolClasses, setSchoolClasses] = useState<Array<{ className: string; gradeLevel: number }>>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [archivedFilter, setArchivedFilter] = useState<'exclude' | 'only'>('exclude');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [cardMember, setCardMember] = useState<MemberRow | null>(null);
  const [detailData, setDetailData] = useState<{
    member: MemberRow;
    loans: Array<Record<string, unknown>>;
    returns: Array<Record<string, unknown>>;
    fines: Array<Record<string, unknown>>;
  } | null>(null);
  const [blockTarget, setBlockTarget] = useState<MemberRow | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<MemberRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    total: number;
    validCount: number;
    invalidCount: number;
    rows: Array<{
      rowNumber: number;
      fullName: string;
      unitOrClass: string;
      typeName: string;
      valid: boolean;
      errors: string[];
    }>;
  } | null>(null);
  const [importRawRows, setImportRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [skipInvalid, setSkipInvalid] = useState(true);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [typeId, setTypeId] = useState('1');
  const [identityNumber, setIdentityNumber] = useState('');
  const [gender, setGender] = useState('Laki-laki');
  const [unitOrClass, setUnitOrClass] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (statusFilter) sp.set('status', statusFilter);
      if (typeFilter) sp.set('typeId', typeFilter);
      if (classFilter) sp.set('className', classFilter);
      if (archivedFilter === 'only') sp.set('archived', 'only');
      const res = await gatewayFetch(`/api/members?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat anggota.');
      setMembers(data.members || []);
      setTypes(data.membershipTypes || []);
      if (Array.isArray(data.schoolClasses)) {
        setSchoolClasses(data.schoolClasses);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat anggota.');
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, typeFilter, classFilter, archivedFilter]);

  useEffect(() => {
    if (authLoading || !user || !canReadMembers) return;
    let active = true;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (statusFilter) sp.set('status', statusFilter);
    if (typeFilter) sp.set('typeId', typeFilter);
    if (classFilter) sp.set('className', classFilter);
    if (archivedFilter === 'only') sp.set('archived', 'only');
    gatewayFetch(`/api/members?${sp.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat anggota.');
        if (active) {
          setMembers(data.members || []);
          setTypes(data.membershipTypes || []);
          if (Array.isArray(data.schoolClasses)) {
            setSchoolClasses(data.schoolClasses);
          }
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat anggota.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadMembers, q, statusFilter, typeFilter, classFilter, archivedFilter]);

  function openCreate() {
    setEditing(null);
    setFullName('');
    setTypeId(types[0] ? String(types[0].id) : '1');
    setIdentityNumber('');
    setGender('Laki-laki');
    setUnitOrClass('');
    setPhone('');
    setEmail('');
    setAddress('');
    setExpiresAt('');
    setFormOpen(true);
  }

  function openEdit(m: MemberRow) {
    setEditing(m);
    setFullName(m.full_name);
    setTypeId(String(m.membership_type_id));
    setIdentityNumber(m.identity_number || '');
    setGender(m.gender || 'Tidak Disebutkan');
    setUnitOrClass(m.unit_or_class || '');
    setPhone(m.phone || '');
    setEmail(m.email || '');
    setAddress(m.address || '');
    setExpiresAt(m.expires_at || '');
    setFormOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      showToast('error', 'Validasi gagal', 'Nama lengkap anggota wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const res = await gatewayFetch(editing ? `/api/members/${editing.id}` : '/api/members', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          membershipTypeId: Number(typeId),
          identityNumber,
          gender,
          unitOrClass,
          phone,
          email,
          address,
          ...(expiresAt ? { expiresAt } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan anggota.');
      showToast('success', editing ? 'Profil diperbarui' : 'Anggota terdaftar', fullName);
      setFormOpen(false);
      loadMembers();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function handleMemberAction(member: MemberRow, action: string, extra?: Record<string, unknown>) {
    setActionBusy(true);
    try {
      const res = await gatewayFetch(`/api/members/${member.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui anggota.');

      const toastMsg =
        action === 'extend'
          ? `Masa berlaku ${member.full_name} diperpanjang hingga ${data.expiresAt || '1 tahun ke depan'}.`
          : action === 'block'
            ? `Anggota ${member.full_name} diblokir sementara.`
            : action === 'unblock'
              ? `Anggota ${member.full_name} diaktifkan kembali.`
              : action === 'deactivate'
                ? `Anggota ${member.full_name} dinonaktifkan.`
                : action === 'archive'
                  ? `Anggota ${member.full_name} berhasil diarsipkan.`
                  : action === 'restore'
                    ? `Anggota ${member.full_name} dipulihkan ke daftar aktif.`
                    : `Data anggota ${member.full_name} diperbarui.`;

      showToast('success', 'Berhasil', toastMsg);
      setBlockTarget(null);
      setArchiveTarget(null);
      setBlockReason('');
      loadMembers();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setActionBusy(false);
    }
  }

  async function openDetail(m: MemberRow) {
    try {
      const res = await gatewayFetch(`/api/members/${m.id}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal memuat detail anggota', data.error || 'Terjadi kesalahan.');
        return;
      }
      setDetailData(data);
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsedRows = await parseSpreadsheetFile(file);
      setImportRawRows(parsedRows);
      const res = await gatewayFetch('/api/members/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', rows: parsedRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memvalidasi berkas anggota.');
      setImportPreview(data);
    } catch (err) {
      showToast('error', 'Format tidak valid', err instanceof Error ? err.message : 'Gagal membaca file');
    }
  }

  async function commitImport() {
    setImporting(true);
    try {
      const res = await gatewayFetch('/api/members/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'commit', rows: importRawRows, skipInvalid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengimpor anggota.');
      showToast('success', 'Import berhasil', `${data.importedCount} anggota baru ditambahkan.`);
      setImportOpen(false);
      setImportPreview(null);
      setImportRawRows([]);
      loadMembers();
    } catch (err) {
      showToast('error', 'Import gagal', err instanceof Error ? err.message : 'Terjadi kesalahan');
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell
      title="Manajemen Data Anggota"
      description="Registrasi keanggotaan, perpanjangan masa berlaku, kartu anggota QR, pemblokiran, import/export, dan riwayat pinjaman."
      requiredPermission="members.read"
      actions={
        <>
          {canWriteMembers && (
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              Import CSV/Excel
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              exportToExcel(
                'data-anggota.xlsx',
                'Anggota',
                members.map((m) => ({
                  Nomor_Anggota: m.member_code,
                  Nama: m.full_name,
                  Jenis: m.membership_type_name,
                  NIS_NIP: m.identity_number,
                  Unit_Kelas: m.unit_or_class,
                  Email: m.email,
                  Telepon: m.phone,
                  Berlaku_Hingga: m.expires_at,
                  Status: m.status,
                }))
              )
            }
          >
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
          {canWriteMembers && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Registrasi Anggota
            </Button>
          )}
        </>
      }
    >
      <div className={cardMember ? 'no-print space-y-4' : 'space-y-4'}>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-4">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="Cari nomor anggota, nama siswa/guru, kelas..."
            ariaLabel="Cari data anggota"
            className="w-full sm:w-72"
          />
          <select
            aria-label="Filter status anggota"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
          >
            <option value="">Semua Status</option>
            <option value="Aktif">Aktif</option>
            <option value="Diblokir">Diblokir</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
          <select
            aria-label="Filter jenis keanggotaan"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
          >
            <option value="">Semua Jenis</option>
            {types.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter rombel atau kelas anggota"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
          >
            <option value="">Semua Rombel / Kelas</option>
            {schoolClasses.map((c) => (
              <option key={c.className} value={c.className}>
                {c.className}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter arsip anggota"
            value={archivedFilter}
            onChange={(e) => setArchivedFilter(e.target.value as 'exclude' | 'only')}
            className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
          >
            <option value="exclude">Anggota Aktif / Terdaftar</option>
            <option value="only">Data Arsip</option>
          </select>
        </div>

        {loading && <LoadingState rows={6} />}
        {error && <ErrorState message={error} onRetry={loadMembers} />}

        {!loading && !error && members.length === 0 && (
          <EmptyState
            title="Anggota tidak ditemukan"
            description="Belum ada anggota yang sesuai dengan filter."
            action={<Button onClick={openCreate}>Registrasi Anggota Baru</Button>}
          />
        )}

        {!loading && !error && members.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">No. Anggota</th>
                    <th className="px-4 py-3">Nama & Unit</th>
                    <th className="px-4 py-3">Jenis</th>
                    <th className="px-4 py-3 text-right">Pinjaman</th>
                    <th className="px-4 py-3 text-right">Denda</th>
                    <th className="px-4 py-3">Masa Berlaku</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F4F3EE]/80">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                        {m.member_code}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{m.full_name}</p>
                        <p className="text-xs text-slate-500">{m.unit_or_class || m.email || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{m.membership_type_name}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {m.active_loans_count} / {m.max_loans}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {m.unpaid_fines_total > 0 ? (
                          <span className="font-semibold text-red-700">
                            {formatCurrencyIDR(m.unpaid_fines_total)}
                          </span>
                        ) : (
                          <span className="text-slate-400">Rp 0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                        {m.expires_at}
                      </td>
                      <td className="px-4 py-3">
                        <StatusIndicator status={m.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openDetail(m)}
                            aria-label={`Riwayat ${m.full_name}`}
                            title="Lihat profil & riwayat"
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCardMember(m)}
                            aria-label={`Kartu anggota ${m.full_name}`}
                            title="Kartu anggota QR"
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                          >
                            <CreditCard className="h-4 w-4" />
                          </button>
                          {archivedFilter === 'only' ? (
                            canWriteMembers && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleMemberAction(m, 'restore')}
                                aria-label={`Pulihkan ${m.full_name}`}
                                title="Pulihkan anggota"
                                className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )
                          ) : (
                            <>
                              {canWriteMembers && (
                                <>
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => handleMemberAction(m, 'extend', { days: 365 })}
                                    aria-label={`Perpanjang keanggotaan ${m.full_name}`}
                                    title="Perpanjang 1 tahun"
                                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#E56B63] cursor-pointer disabled:opacity-50"
                                  >
                                    <CalendarPlus className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEdit(m)}
                                    aria-label={`Edit ${m.full_name}`}
                                    title="Edit profil anggota"
                                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {canBlockMembers &&
                                (m.status === 'Diblokir' || m.status === 'Nonaktif' ? (
                                  <button
                                    type="button"
                                    disabled={actionBusy}
                                    onClick={() => handleMemberAction(m, 'unblock')}
                                    aria-label={`Aktifkan kembali ${m.full_name}`}
                                    title="Aktifkan kembali"
                                    className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-50"
                                  >
                                    <ShieldCheck className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={actionBusy}
                                      onClick={() => handleMemberAction(m, 'deactivate')}
                                      aria-label={`Nonaktifkan ${m.full_name}`}
                                      title="Nonaktifkan sementara"
                                      className="rounded p-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-700 cursor-pointer disabled:opacity-50"
                                    >
                                      <UserX className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBlockReason('');
                                        setBlockTarget(m);
                                      }}
                                      aria-label={`Blokir ${m.full_name}`}
                                      title="Blokir sementara"
                                      className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                                    >
                                      <Ban className="h-4 w-4" />
                                    </button>
                                  </>
                                ))}
                              {canWriteMembers && (
                                <button
                                  type="button"
                                  onClick={() => setArchiveTarget(m)}
                                  aria-label={`Arsipkan ${m.full_name}`}
                                  title="Arsipkan anggota"
                                  className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                                >
                                  <Archive className="h-4 w-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Member */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit Profil · ${editing.member_code}` : 'Registrasi Anggota Baru'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <TextField
            label="Nama Lengkap *"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Jenis Keanggotaan"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <SelectField label="Jenis Kelamin" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="Laki-laki">Laki-laki</option>
              <option value="Perempuan">Perempuan</option>
              <option value="Tidak Disebutkan">Tidak Disebutkan</option>
            </SelectField>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="NIS / NISN / NIP"
              value={identityNumber}
              onChange={(e) => setIdentityNumber(e.target.value)}
            />
            <div className="space-y-1.5">
              <TextField
                label="Kelas / Jabatan"
                value={unitOrClass}
                onChange={(e) => setUnitOrClass(e.target.value)}
                list="member-rombel-options"
                placeholder="Pilih rombel atau ketik jabatan (misal: Kelas 6D)"
              />
              <datalist id="member-rombel-options">
                {schoolClasses.map((c) => (
                  <option key={c.className} value={c.className} />
                ))}
              </datalist>
              {schoolClasses.length > 0 && (
                <select
                  aria-label="Pilih cepat rombel kelas SD"
                  value={
                    schoolClasses.some(
                      (c) => c.className.toLowerCase() === unitOrClass.trim().toLowerCase()
                    )
                      ? schoolClasses.find(
                          (c) => c.className.toLowerCase() === unitOrClass.trim().toLowerCase()
                        )?.className || ''
                      : ''
                  }
                  onChange={(e) => {
                    if (e.target.value) setUnitOrClass(e.target.value);
                  }}
                  className="h-8 w-full rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] px-2.5 text-xs text-[#4A4945] focus:border-[#222B3A] focus:outline-none"
                >
                  <option value="">Pilih cepat rombel terdaftar ({schoolClasses.length} rombel)...</option>
                  {schoolClasses.map((c) => (
                    <option key={c.className} value={c.className}>
                      {c.className}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Nomor Telepon"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Alamat" value={address} onChange={(e) => setAddress(e.target.value)} />
            <TextField
              label="Masa Berlaku Hingga"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              Simpan Data Anggota
            </Button>
          </div>
        </form>
      </Modal>

      {/* Member Card Print Modal */}
      <Modal
        open={Boolean(cardMember)}
        onClose={() => setCardMember(null)}
        title="Kartu Anggota Perpustakaan"
        maxWidth="max-w-lg"
      >
        {cardMember && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#DFDCD4] bg-[#FAF9F5] p-6">
              <div className="flex items-start justify-between gap-4 border-b border-[#E7E4DC] pb-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E56B63]">
                    {library.name}
                  </p>
                  {(library.npsn || library.academicYear) && (
                    <p className="text-[10px] text-slate-500">
                      {[
                        library.npsn ? `NPSN ${library.npsn}` : '',
                        library.academicYear ? `TA ${library.academicYear} (${library.semester || 'Ganjil'})` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <h3 className="mt-1 font-serif text-lg font-bold text-slate-900">
                    {cardMember.full_name}
                  </h3>
                  <p className="text-xs text-slate-600">{cardMember.membership_type_name}</p>
                </div>
                <QrCodeImage value={cardMember.member_code} size={80} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-slate-500">Nomor Anggota</dt>
                  <dd className="font-mono font-semibold text-slate-900">{cardMember.member_code}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Kelas / Jabatan</dt>
                  <dd className="text-slate-900">{cardMember.unit_or_class || '-'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Terdaftar</dt>
                  <dd className="font-mono text-slate-700">{cardMember.registered_at}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Berlaku Hingga</dt>
                  <dd className="font-mono font-semibold text-slate-900">{cardMember.expires_at}</dd>
                </div>
              </dl>
              {library.address && (
                <p className="mt-3 border-t border-[#E7E4DC] pt-2.5 text-[10px] text-slate-500">
                  {library.address}
                  {library.phone ? ` · ${library.phone}` : ''}
                </p>
              )}
            </div>
            <div className="no-print flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCardMember(null)}>
                Tutup
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Cetak Kartu
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Member History Detail Modal */}
      <Modal
        open={Boolean(detailData)}
        onClose={() => setDetailData(null)}
        title={detailData ? `Riwayat Anggota · ${detailData.member.full_name}` : ''}
        maxWidth="max-w-3xl"
      >
        {detailData && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#E7E4DC] bg-[#F4F3EE]/60 p-3.5 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-slate-500">Nomor Anggota</p>
                <p className="font-mono font-semibold text-slate-900">{detailData.member.member_code}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Jenis &amp; Kelas</p>
                <p className="font-medium text-slate-900">
                  {detailData.member.membership_type_name}
                  {detailData.member.unit_or_class ? ` · ${detailData.member.unit_or_class}` : ''}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Status</p>
                <div className="mt-0.5">
                  <StatusIndicator status={detailData.member.status} />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">Berlaku Hingga</p>
                <p className="font-mono text-slate-900">{detailData.member.expires_at}</p>
              </div>
              {detailData.member.block_reason && (
                <div className="col-span-2 sm:col-span-4 rounded-md border border-[#F2C6C3] bg-[#FDF2F1] px-3 py-2 text-[#9E352F]">
                  <strong>Alasan Blokir:</strong> {detailData.member.block_reason}
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Riwayat Peminjaman</h3>
              {detailData.loans.length === 0 ? (
                <p className="text-slate-500">Belum ada riwayat peminjaman.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                  <table className="w-full text-left">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">No. Pinjam</th>
                        <th className="px-3 py-2">Judul Buku</th>
                        <th className="px-3 py-2">Pinjam</th>
                        <th className="px-3 py-2">Jatuh Tempo</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {detailData.loans.map((l, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-mono">{String(l.loan_number)}</td>
                          <td className="px-3 py-2">{String(l.book_title)}</td>
                          <td className="px-3 py-2 font-mono">{String(l.loan_date)}</td>
                          <td className="px-3 py-2 font-mono">{String(l.due_date)}</td>
                          <td className="px-3 py-2 text-right">
                            <StatusIndicator status={String(l.item_status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Riwayat Pengembalian</h3>
              {detailData.returns.length === 0 ? (
                <p className="text-slate-500">Belum ada riwayat pengembalian.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                  <table className="w-full text-left">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">No. Kembali</th>
                        <th className="px-3 py-2">Judul Buku</th>
                        <th className="px-3 py-2">Tanggal</th>
                        <th className="px-3 py-2">Kondisi</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {detailData.returns.map((r, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-mono">{String(r.return_number)}</td>
                          <td className="px-3 py-2">{String(r.book_title || '-')}</td>
                          <td className="px-3 py-2 font-mono">{String(r.returned_at)}</td>
                          <td className="px-3 py-2">{String(r.condition)}</td>
                          <td className="px-3 py-2 text-right">
                            <StatusIndicator status={String(r.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Riwayat Denda</h3>
              {detailData.fines.length === 0 ? (
                <p className="text-slate-500">Tidak ada catatan denda.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-[#E7E4DC]">
                  <table className="w-full text-left">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">No. Denda</th>
                        <th className="px-3 py-2">Jenis</th>
                        <th className="px-3 py-2 text-right">Tagihan</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {detailData.fines.map((f, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-mono">{String(f.fine_number)}</td>
                          <td className="px-3 py-2">{String(f.fine_type)}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCurrencyIDR(Number(f.amount))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <StatusIndicator status={String(f.status)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Block Member Confirm */}
      <Modal
        open={Boolean(blockTarget)}
        onClose={() => {
          setBlockTarget(null);
          setBlockReason('');
        }}
        title={`Blokir Sementara · ${blockTarget?.full_name}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <TextField
            label="Alasan Pemblokiran"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Contoh: Menunggak buku lebih dari 14 hari"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={actionBusy}
              onClick={() => {
                setBlockTarget(null);
                setBlockReason('');
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              loading={actionBusy}
              onClick={() =>
                blockTarget &&
                handleMemberAction(blockTarget, 'block', { reason: blockReason })
              }
            >
              Blokir Anggota
            </Button>
          </div>
        </div>
      </Modal>

      {/* Import Members Modal */}
      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportPreview(null);
        }}
        title="Import Anggota via CSV / Excel (.xlsx)"
        description="Unggah berkas dengan kolom: fullName, unitOrClass, membershipType, identityNumber, email, phone, address."
        maxWidth="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-4">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              aria-label="Pilih berkas CSV atau Excel anggota"
              onChange={handleImportFile}
              className="text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#222B3A] file:px-3 file:py-2 file:text-xs file:font-medium file:text-white"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportToCsv('template-import-anggota.csv', [
                  {
                    fullName: 'Nadia Putri Pratama',
                    unitOrClass: 'Kelas 5A',
                    membershipType: 'Siswa Kelas 4–6',
                    identityNumber: '2026050112',
                    email: 'nadia.5a@sd.lenterapustaka.id',
                    phone: '081234567801',
                    address: 'Jl. Dago No. 12',
                  },
                ])
              }
            >
              Unduh Template CSV
            </Button>
          </div>

          {importPreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span>
                  Total: <strong>{importPreview.total}</strong> · Valid:{' '}
                  <strong className="text-emerald-700">{importPreview.validCount}</strong> · Bermasalah:{' '}
                  <strong className="text-red-700">{importPreview.invalidCount}</strong>
                </span>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={skipInvalid}
                    onChange={(e) => setSkipInvalid(e.target.checked)}
                  />
                  Lewati baris bermasalah saat konfirmasi
                </label>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-lg border border-[#E7E4DC]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Nama Lengkap</th>
                      <th className="px-3 py-2">Kelas / Unit</th>
                      <th className="px-3 py-2">Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {importPreview.rows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="px-3 py-2 font-mono">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.fullName || '-'}</td>
                        <td className="px-3 py-2">{r.unitOrClass || '-'}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <StatusIndicator status="Valid" />
                          ) : (
                            <span className="text-red-700">{r.errors.join(', ')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={importing} onClick={() => setImportOpen(false)}>
                  Batal
                </Button>
                <Button onClick={commitImport} loading={importing} disabled={importPreview.validCount === 0}>
                  Konfirmasi Import ({importPreview.validCount} Anggota)
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && handleMemberAction(archiveTarget, 'archive')}
        title="Arsipkan Anggota"
        message={`Anggota "${archiveTarget?.full_name}" akan diarsipkan (soft delete) sehingga riwayat transaksi tetap terjaga. Lanjutkan?`}
        confirmLabel="Ya, Arsipkan"
        loading={actionBusy}
      />
    </AppShell>
  );
}
