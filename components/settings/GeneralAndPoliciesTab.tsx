'use client';

import React, { useState } from 'react';
import { Building2, Plus, Save, Scale, SlidersHorizontal } from 'lucide-react';
import {
  Button,
  Modal,
  SelectField,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { formatCurrencyIDR } from '@/lib/domain/library-rules';
import { gatewayFetch } from '@/lib/client/data-gateway';
import type { MembershipTypeRow } from './types';

interface GeneralPanelProps {
  settings: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  canWrite: boolean;
  onSaved: () => Promise<void>;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export function GeneralSettingsPanel({
  settings,
  onChange,
  canWrite,
  onSaved,
  notify,
}: GeneralPanelProps) {
  const [saving, setSaving] = useState(false);

  const setVal = (key: string, val: string) => {
    onChange({ ...settings, [key]: val });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'general', settings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan pengaturan sistem.');
      notify('Identitas sekolah dan aturan operasional berhasil disimpan.', 'success');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: School & Library Identity */}
      <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-[#E7E4DC] pb-3">
          <Building2 className="h-4 w-4 text-[#222B3A]" />
          <div>
            <h2 className="font-serif text-base font-semibold text-[#1E2433]">
              Identitas &amp; Kop Perpustakaan Sekolah
            </h2>
            <p className="text-xs text-[#5C5E64]">
              Digunakan pada kop laporan cetak, kartu anggota, dan halaman katalog publik OPAC.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Nama Perpustakaan / Sekolah"
            value={settings.library_name || ''}
            onChange={(e) => setVal('library_name', e.target.value)}
            disabled={!canWrite}
            required
          />
          <TextField
            label="Slogan / Tagline Literasi"
            value={settings.library_tagline || ''}
            onChange={(e) => setVal('library_tagline', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="NPSN Sekolah"
            value={settings.school_npsn || ''}
            onChange={(e) => setVal('school_npsn', e.target.value)}
            disabled={!canWrite}
            placeholder="20109842"
          />
          <TextField
            label="Kepala Sekolah"
            value={settings.principal_name || ''}
            onChange={(e) => setVal('principal_name', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Kepala Perpustakaan"
            value={settings.librarian_head_name || ''}
            onChange={(e) => setVal('librarian_head_name', e.target.value)}
            disabled={!canWrite}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Tahun Ajaran"
              value={settings.academic_year || ''}
              onChange={(e) => setVal('academic_year', e.target.value)}
              disabled={!canWrite}
              placeholder="2026/2027"
            />
            <SelectField
              label="Semester"
              value={settings.semester || 'Ganjil'}
              onChange={(e) => setVal('semester', e.target.value)}
              disabled={!canWrite}
            >
              <option value="Ganjil">Ganjil</option>
              <option value="Genap">Genap</option>
            </SelectField>
          </div>
          <TextField
            label="Email Resmi"
            type="email"
            value={settings.library_email || ''}
            onChange={(e) => setVal('library_email', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Nomor Telepon"
            value={settings.library_phone || ''}
            onChange={(e) => setVal('library_phone', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Situs Web / Portal Sekolah"
            value={settings.library_website || ''}
            onChange={(e) => setVal('library_website', e.target.value)}
            disabled={!canWrite}
            placeholder="https://..."
          />
          <TextField
            label="Jam Operasional"
            value={settings.operational_hours || ''}
            onChange={(e) => setVal('operational_hours', e.target.value)}
            disabled={!canWrite}
            className="md:col-span-2"
          />
          <TextField
            label="Alamat Lengkap"
            value={settings.library_address || ''}
            onChange={(e) => setVal('library_address', e.target.value)}
            disabled={!canWrite}
            className="lg:col-span-3"
          />
        </div>
      </section>

      {/* Section 2: Global Circulation, Fine & Reservation Rules */}
      <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5">
        <div className="mb-4 flex items-center gap-2 border-b border-[#E7E4DC] pb-3">
          <SlidersHorizontal className="h-4 w-4 text-[#222B3A]" />
          <div>
            <h2 className="font-serif text-base font-semibold text-[#1E2433]">
              Aturan Global Sirkulasi, Denda &amp; Reservasi
            </h2>
            <p className="text-xs text-[#5C5E64]">
              Menentukan ambang pemblokiran otomatis, masa tenggang keterlambatan, dan kebijakan denda.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Masa Tenggang Keterlambatan (Hari)"
            type="number"
            min={0}
            max={14}
            value={settings.grace_period_days || '0'}
            onChange={(e) => setVal('grace_period_days', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Persentase Denda Rusak Berat (%)"
            type="number"
            min={0}
            max={100}
            value={settings.default_damage_fee_percent || '50'}
            onChange={(e) => setVal('default_damage_fee_percent', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Persentase Ganti Rugi Buku Hilang (%)"
            type="number"
            min={0}
            max={200}
            value={settings.lost_book_fee_percent || '100'}
            onChange={(e) => setVal('lost_book_fee_percent', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Batas Tunggakan Blokir Pinjam (Rp)"
            type="number"
            min={0}
            step={1000}
            value={settings.block_on_unpaid_fines_limit || '25000'}
            onChange={(e) => setVal('block_on_unpaid_fines_limit', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Batas Ambil Reservasi (Hari)"
            type="number"
            min={1}
            max={14}
            value={settings.reservation_expiry_days || '3'}
            onChange={(e) => setVal('reservation_expiry_days', e.target.value)}
            disabled={!canWrite}
          />
          <TextField
            label="Pengingat Jatuh Tempo (H-N Hari)"
            type="number"
            min={1}
            max={7}
            value={settings.auto_reminder_days_before_due || '2'}
            onChange={(e) => setVal('auto_reminder_days_before_due', e.target.value)}
            disabled={!canWrite}
          />
          <SelectField
            label="Penerapan Perubahan Kebijakan"
            value={
              settings.policy_application_mode === 'apply_to_active'
                ? 'apply_to_active'
                : 'new_loans_only'
            }
            onChange={(e) => setVal('policy_application_mode', e.target.value)}
            disabled={!canWrite}
            className="md:col-span-2 lg:col-span-3"
          >
            <option value="new_loans_only">
              Hanya Berlaku untuk Peminjaman Baru (Disarankan — Menjaga Transaksi Berjalan)
            </option>
            <option value="apply_to_active">
              Terapkan ke Seluruh Peminjaman Aktif &amp; Baru
            </option>
          </SelectField>
        </div>

        {/* Boolean Policy Switches */}
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[#E7E4DC] pt-4 md:grid-cols-3">
          {[
            {
              key: 'allow_partial_fine_payment',
              title: 'Izinkan Pembayaran Denda Cicilan',
              desc: 'Anggota dapat melunasi tagihan denda secara bertahap (sebagian).',
            },
            {
              key: 'allow_overdue_renewal',
              title: 'Izinkan Perpanjangan Saat Terlambat',
              desc: 'Jika nonaktif, buku lewat jatuh tempo wajib dikembalikan terlebih dahulu.',
            },
            {
              key: 'enable_opac_public',
              title: 'Aktifkan Katalog Publik (OPAC)',
              desc: 'Siswa, orang tua, dan tamu dapat menelusuri koleksi tanpa login.',
            },
          ].map((item) => {
            const checked = (settings[item.key] || 'false') === 'true';
            return (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#E7E4DC] bg-white p-3.5 transition-colors hover:border-[#CFCAC0]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!canWrite}
                  onChange={(e) => setVal(item.key, e.target.checked ? 'true' : 'false')}
                  className="mt-0.5 h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1E2433]">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#5C5E64]">{item.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        {canWrite && (
          <div className="mt-5 flex justify-end border-t border-[#E7E4DC] pt-4">
            <Button type="submit" loading={saving}>
              <Save className="h-4 w-4" />
              Simpan Identitas &amp; Aturan
            </Button>
          </div>
        )}
      </section>
    </form>
  );
}

interface PoliciesPanelProps {
  membershipTypes: MembershipTypeRow[];
  onChange: (next: MembershipTypeRow[]) => void;
  canWrite: boolean;
  onSaved: () => Promise<void>;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export function MembershipPoliciesPanel({
  membershipTypes,
  onChange,
  canWrite,
  onSaved,
  notify,
}: PoliciesPanelProps) {
  const [savingId, setSavingId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({
    code: '',
    name: '',
    max_loans: 3,
    loan_duration_days: 7,
    max_renewals: 1,
    daily_fine_rate: 500,
    max_fine_cap: 15000,
    allow_reservation: true,
  });

  const updateRow = (idx: number, patch: Partial<MembershipTypeRow>) => {
    const next = [...membershipTypes];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const handleSaveRow = async (mt: MembershipTypeRow) => {
    setSavingId(mt.id);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'membership_type', membershipType: mt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan kebijakan.');
      notify(`Kebijakan jenis anggota "${mt.name}" berhasil diperbarui.`, 'success');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan kebijakan.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'membership_type_create',
          membershipType: newForm,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menambah jenis anggota.');
      notify(`Jenis anggota "${newForm.name}" berhasil ditambahkan.`, 'success');
      setCreateOpen(false);
      setNewForm({
        code: '',
        name: '',
        max_loans: 3,
        loan_duration_days: 7,
        max_renewals: 1,
        daily_fine_rate: 500,
        max_fine_cap: 15000,
        allow_reservation: true,
      });
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menambah jenis anggota.', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Scale className="h-4 w-4 text-[#222B3A]" />
          <div>
            <h2 className="font-serif text-base font-semibold text-[#1E2433]">
              Kebijakan Sirkulasi per Jenis Anggota
            </h2>
            <p className="text-xs text-[#5C5E64]">
              Atur kuota buku, lama pinjam, hak perpanjangan, tarif denda harian, dan izin reservasi.
            </p>
          </div>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Tambah Jenis Anggota
          </Button>
        )}
      </div>

      {/* Comparison Summary Table */}
      <div className="overflow-x-auto rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
              <th className="px-4 py-2.5 font-semibold">Kode</th>
              <th className="px-4 py-2.5 font-semibold">Jenis Anggota</th>
              <th className="px-4 py-2.5 text-right font-semibold">Anggota Aktif</th>
              <th className="px-4 py-2.5 text-right font-semibold">Kuota</th>
              <th className="px-4 py-2.5 text-right font-semibold">Durasi</th>
              <th className="px-4 py-2.5 text-right font-semibold">Denda / Hari</th>
              <th className="px-4 py-2.5 text-right font-semibold">Maks Denda</th>
              <th className="px-4 py-2.5 font-semibold">Reservasi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ECE9E1]">
            {membershipTypes.map((mt) => (
              <tr key={mt.id} className="hover:bg-[#F4F3EE]/60">
                <td className="px-4 py-2.5 font-mono font-medium text-[#1E2433]">{mt.code}</td>
                <td className="px-4 py-2.5 font-medium text-[#1E2433]">{mt.name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#4A4945]">
                  {mt.member_count ?? 0}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#1E2433]">
                  {mt.max_loans} buku
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#1E2433]">
                  {mt.loan_duration_days} hari
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#1E2433]">
                  {formatCurrencyIDR(mt.daily_fine_rate)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#1E2433]">
                  {formatCurrencyIDR(mt.max_fine_cap)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusIndicator status={mt.allow_reservation ? 'Aktif' : 'Nonaktif'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Editable Policy Forms */}
      <div className="space-y-3">
        {membershipTypes.map((mt, idx) => (
          <div
            key={mt.id}
            className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#ECE9E1] pb-3">
              <div>
                <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                  {mt.name}{' '}
                  <span className="font-mono text-xs font-normal text-[#7B7D82]">({mt.code})</span>
                </h3>
                <p className="text-xs text-[#5C5E64] tabular-nums">
                  {mt.member_count ?? 0} anggota terdaftar pada tipe ini
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[#1E2433]">
                <input
                  type="checkbox"
                  checked={Boolean(mt.allow_reservation)}
                  disabled={!canWrite}
                  onChange={(e) => updateRow(idx, { allow_reservation: e.target.checked ? 1 : 0 })}
                  className="h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                />
                Izinkan Reservasi Buku
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <TextField
                label="Nama Tipe"
                value={mt.name}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { name: e.target.value })}
                className="col-span-2 md:col-span-1"
              />
              <TextField
                label="Maks Pinjam"
                type="number"
                min={1}
                max={30}
                value={String(mt.max_loans)}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { max_loans: Number(e.target.value) })}
              />
              <TextField
                label="Durasi (Hari)"
                type="number"
                min={1}
                max={90}
                value={String(mt.loan_duration_days)}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { loan_duration_days: Number(e.target.value) })}
              />
              <TextField
                label="Maks Perpanjang"
                type="number"
                min={0}
                max={10}
                value={String(mt.max_renewals)}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { max_renewals: Number(e.target.value) })}
              />
              <TextField
                label="Denda/Hari (Rp)"
                type="number"
                min={0}
                step={500}
                value={String(mt.daily_fine_rate)}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { daily_fine_rate: Number(e.target.value) })}
              />
              <TextField
                label="Maks Denda (Rp)"
                type="number"
                min={0}
                step={1000}
                value={String(mt.max_fine_cap)}
                disabled={!canWrite}
                onChange={(e) => updateRow(idx, { max_fine_cap: Number(e.target.value) })}
              />
            </div>

            {canWrite && (
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  loading={savingId === mt.id}
                  onClick={() => handleSaveRow(mt)}
                >
                  <Save className="h-3.5 w-3.5" />
                  Simpan Kebijakan {mt.code}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal Tambah Jenis Anggota */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Jenis Anggota Baru"
        description="Buat tier keanggotaan baru seperti Siswa Kelas 1–3, Guru Pendamping, atau Komite Sekolah."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Kode Unik (Kapital)"
              placeholder="SISWA_TINGGI"
              value={newForm.code}
              onChange={(e) => setNewForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              required
            />
            <TextField
              label="Nama Jenis Anggota"
              placeholder="Siswa Kelas 4–6"
              value={newForm.name}
              onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <TextField
              label="Maksimal Pinjam (Buku)"
              type="number"
              min={1}
              max={30}
              value={String(newForm.max_loans)}
              onChange={(e) => setNewForm((f) => ({ ...f, max_loans: Number(e.target.value) }))}
              required
            />
            <TextField
              label="Durasi Pinjam (Hari)"
              type="number"
              min={1}
              max={90}
              value={String(newForm.loan_duration_days)}
              onChange={(e) =>
                setNewForm((f) => ({ ...f, loan_duration_days: Number(e.target.value) }))
              }
              required
            />
            <TextField
              label="Maks Perpanjangan"
              type="number"
              min={0}
              max={10}
              value={String(newForm.max_renewals)}
              onChange={(e) => setNewForm((f) => ({ ...f, max_renewals: Number(e.target.value) }))}
            />
            <TextField
              label="Tarif Denda / Hari (Rp)"
              type="number"
              min={0}
              step={500}
              value={String(newForm.daily_fine_rate)}
              onChange={(e) =>
                setNewForm((f) => ({ ...f, daily_fine_rate: Number(e.target.value) }))
              }
            />
            <TextField
              label="Maksimal Denda / Cap (Rp)"
              type="number"
              min={0}
              step={1000}
              value={String(newForm.max_fine_cap)}
              onChange={(e) => setNewForm((f) => ({ ...f, max_fine_cap: Number(e.target.value) }))}
              className="sm:col-span-2"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-[#1E2433]">
            <input
              type="checkbox"
              checked={newForm.allow_reservation}
              onChange={(e) => setNewForm((f) => ({ ...f, allow_reservation: e.target.checked }))}
              className="h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
            />
            Izinkan anggota tipe ini melakukan reservasi buku
          </label>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={creating}>
              Tambah Jenis Anggota
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
