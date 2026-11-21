'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  School,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Button, Modal, SelectField, TextField } from '@/components/ui/DesignPrimitives';
import { canApproverAssignRole } from '@/lib/domain/signup-rules';
import type { RegistrationRequestRow, RoleRow } from './types';

interface RegistrationReviewModalProps {
  request: RegistrationRequestRow | null;
  roles: RoleRow[];
  currentUserRoleSlug?: string;
  busy: boolean;
  onClose: () => void;
  onApprove: (options: {
    request: RegistrationRequestRow;
    roleId: number;
    roleSlug: string;
    applyClassTeacherSync: boolean;
    syncSchedules: boolean;
    applyLeadershipSync: boolean;
    note: string;
  }) => Promise<void>;
  onReject: (options: {
    request: RegistrationRequestRow;
    note: string;
  }) => Promise<void>;
}

const META_LABELS: Record<string, string> = {
  subjectName: 'Mata Pelajaran',
  bkScope: 'Lingkup Binaan BK',
  wakasekField: 'Bidang Wakasek',
  committeeRelation: 'Status Komite',
  childName: 'Nama Anak / Siswa',
  serviceShift: 'Shift Layanan',
  libraryArea: 'Area Layanan Perpus',
  tuSection: 'Urusan Tata Usaha',
  fundScope: 'Pengelolaan Dana',
  itFocus: 'Fokus Operator IT',
  dutyArea: 'Area Tugas',
  memberSubStatus: 'Status Warga Sekolah',
  unitLabel: 'Unit / Bagian',
  visitorOrigin: 'Asal Instansi / Keperluan',
  literacyDuty: 'Fokus Duta Literasi',
  decreeNumber: 'Nomor SK',
  qualification: 'Kualifikasi / Sertifikasi',
};

export function RegistrationReviewModal({
  request,
  roles,
  currentUserRoleSlug,
  busy,
  onClose,
  onApprove,
  onReject,
}: RegistrationReviewModalProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [applyClassTeacherSync, setApplyClassTeacherSync] = useState<boolean>(true);
  const [syncSchedules, setSyncSchedules] = useState<boolean>(true);
  const [applyLeadershipSync, setApplyLeadershipSync] = useState<boolean>(false);
  const [decisionNote, setDecisionNote] = useState<string>('');
  const [prevRequestId, setPrevRequestId] = useState<string | number | null>(null);

  const reqKey = request ? request.docId || request.id : null;
  if (request && reqKey !== prevRequestId) {
    setPrevRequestId(reqKey);
    setSelectedRoleId(String(request.requestedRoleId));
    setApplyClassTeacherSync(true);
    setSyncSchedules(true);
    setApplyLeadershipSync(
      request.requestedRoleSlug === 'kepala_sekolah' ||
        request.requestedRoleSlug === 'kepala_perpustakaan'
    );
    setDecisionNote('');
  }

  const assignableRoles = useMemo(() => {
    return roles.filter((r) => canApproverAssignRole(currentUserRoleSlug, r.slug));
  }, [roles, currentUserRoleSlug]);

  const groupedRoles = useMemo(() => {
    const groups = new Map<string, RoleRow[]>();
    for (const r of assignableRoles) {
      const cat = r.category || 'Warga Sekolah';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(r);
    }
    return Array.from(groups.entries());
  }, [assignableRoles]);

  if (!request) return null;

  const chosenRole =
    assignableRoles.find((r) => String(r.id) === selectedRoleId) ||
    assignableRoles.find((r) => r.slug === request.requestedRoleSlug) ||
    assignableRoles[0];

  const isTeacherClassRole =
    chosenRole?.slug === 'wali_kelas' || chosenRole?.slug === 'guru_pendamping';
  const isLeadershipRole =
    chosenRole?.slug === 'kepala_sekolah' || chosenRole?.slug === 'kepala_perpustakaan';
  const slotLabel =
    request.teacherSlot === 'companion' || chosenRole?.slug === 'guru_pendamping'
      ? 'Guru Pendamping'
      : 'Wali Kelas';

  const extraEntries = Object.entries(request.extraMeta || {}).filter(([, v]) => Boolean(v));

  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      title={`Tinjau Pendaftaran & Resolusi Konflik — ${request.requestCode}`}
      description="Bandingkan data eksisting dengan data pendaftar, pilih perubahan mana yang diterapkan atau dipertahankan, lalu putuskan Setujui (Ya) atau Tolak (Tidak)."
      maxWidth="max-w-2xl"
    >
      <div className="space-y-5 text-xs">
        {/* Applicant Summary */}
        <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-serif text-base font-semibold text-[#1E2433]">
                {request.fullName}
              </p>
              <p className="text-[#5C5E64]">
                <span className="font-mono">@{request.username}</span> ·{' '}
                <span className="font-mono">{request.email}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-[#E2DFD7] bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-[#222B3A]">
                {request.requestCode}
              </span>
              {request.hasConflict ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-950">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Konflik Data
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verifikasi Peran
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 border-t border-[#EAE7DF] pt-2.5 sm:grid-cols-2">
            <div>
              <span className="text-[#7B7D82]">Peran Diajukan:</span>{' '}
              <strong className="text-[#1E2433]">{request.requestedRoleName}</strong>
            </div>
            {request.assignedClass && (
              <div>
                <span className="text-[#7B7D82]">Kelas Dipilih:</span>{' '}
                <strong className="text-[#1E2433]">{request.assignedClass}</strong>
              </div>
            )}
            {request.identityNumber && (
              <div>
                <span className="text-[#7B7D82]">NIP / NIS / ID:</span>{' '}
                <strong className="font-mono text-[#1E2433]">{request.identityNumber}</strong>
              </div>
            )}
            {request.phone && (
              <div>
                <span className="text-[#7B7D82]">No. Telepon:</span>{' '}
                <strong className="font-mono text-[#1E2433]">{request.phone}</strong>
              </div>
            )}
            {extraEntries.map(([k, v]) => (
              <div key={k}>
                <span className="text-[#7B7D82]">{META_LABELS[k] || k}:</span>{' '}
                <strong className="text-[#1E2433]">{v}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Side-by-Side Conflict Comparison */}
        {request.hasConflict && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-semibold text-amber-950">
                  Konflik Data Terdeteksi — Bandingkan &amp; Pilih Penerapan
                </p>
                <p className="mt-0.5 text-amber-900">{request.conflictSummary}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] items-center">
              <div className="rounded-lg border border-[#E2DFD7] bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7B7D82]">
                  Data Saat Ini di Sistem
                </p>
                <p className="mt-1 font-serif text-sm font-semibold text-[#1E2433]">
                  {request.conflictExistingValue || '(Kosong)'}
                </p>
                <p className="mt-0.5 text-[11px] text-[#5C5E64]">
                  {request.assignedClass
                    ? `${slotLabel} · ${request.assignedClass}`
                    : request.requestedRoleName}
                </p>
              </div>

              <div className="hidden sm:flex items-center justify-center text-amber-700">
                <ArrowRight className="h-4 w-4" />
              </div>

              <div className="rounded-lg border border-amber-300 bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                  Data Pendaftar Baru
                </p>
                <p className="mt-1 font-serif text-sm font-semibold text-[#1E2433]">
                  {request.fullName}
                </p>
                <p className="mt-0.5 text-[11px] text-[#5C5E64]">
                  {request.assignedClass
                    ? `${slotLabel} · ${request.assignedClass}`
                    : request.requestedRoleName}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Granular Apply / Keep Decisions */}
        <div className="rounded-xl border border-[#E7E4DC] bg-white p-4 space-y-3.5">
          <div className="flex items-center gap-2 text-[#1E2433]">
            <UserCheck className="h-4 w-4 text-[#E56B63]" />
            <h4 className="font-serif text-sm font-semibold">
              Pilih Mana yang Diterapkan Jika Disetujui (Ya)
            </h4>
          </div>

          <SelectField
            label="Peran Akhir Akun yang Ditetapkan"
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value)}
          >
            {groupedRoles.map(([category, items]) => (
              <optgroup key={category} label={category}>
                {items.map((r) => (
                  <option key={r.id} value={String(r.id)}>
                    {r.name} ({r.slug})
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectField>

          {isTeacherClassRole && request.assignedClass && (
            <div className="space-y-2.5 rounded-lg border border-[#EAE7DF] bg-[#FAF9F5] p-3.5">
              <div className="flex items-center gap-1.5 font-semibold text-[#1E2433]">
                <School className="h-3.5 w-3.5 text-[#E56B63]" />
                Keputusan Data {slotLabel} untuk {request.assignedClass}
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-[#E2DFD7] bg-white p-2.5 cursor-pointer hover:border-[#222B3A]">
                <input
                  type="radio"
                  name="class-teacher-resolution"
                  checked={applyClassTeacherSync}
                  onChange={() => setApplyClassTeacherSync(true)}
                  className="mt-0.5 accent-[#222B3A]"
                />
                <div>
                  <p className="font-semibold text-[#1E2433]">
                    Terapkan &ldquo;{request.fullName}&rdquo; sebagai {slotLabel} {request.assignedClass}
                  </p>
                  <p className="text-[11px] text-[#5C5E64]">
                    {request.conflictExistingValue
                      ? `Menggantikan "${request.conflictExistingValue}" pada data rombel ${request.assignedClass}.`
                      : `Mengisi slot ${slotLabel} pada data rombel ${request.assignedClass}.`}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 rounded-lg border border-[#E2DFD7] bg-white p-2.5 cursor-pointer hover:border-[#222B3A]">
                <input
                  type="radio"
                  name="class-teacher-resolution"
                  checked={!applyClassTeacherSync}
                  onChange={() => setApplyClassTeacherSync(false)}
                  className="mt-0.5 accent-[#222B3A]"
                />
                <div>
                  <p className="font-semibold text-[#1E2433]">
                    Pertahankan data kelas eksisting ({request.conflictExistingValue || 'tidak diubah'})
                  </p>
                  <p className="text-[11px] text-[#5C5E64]">
                    Akun pendaftar tetap dibuat dan aktif, namun data {slotLabel} di {request.assignedClass} dan jadwal baca tidak ditimpa.
                  </p>
                </div>
              </label>

              {applyClassTeacherSync && (
                <label className="flex items-start gap-2.5 pt-1 pl-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncSchedules}
                    onChange={(e) => setSyncSchedules(e.target.checked)}
                    className="mt-0.5 accent-[#222B3A]"
                  />
                  <span className="text-[11px] text-[#1E2433]">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Calendar className="h-3 w-3 text-[#E56B63]" />
                      Sinkronkan juga ke seluruh Jadwal Baca aktif {request.assignedClass}
                    </span>{' '}
                    (perbarui nama {slotLabel} pada jadwal literasi).
                  </span>
                </label>
              )}
            </div>
          )}

          {isLeadershipRole && (
            <div className="space-y-2 rounded-lg border border-[#EAE7DF] bg-[#FAF9F5] p-3.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyLeadershipSync}
                  onChange={(e) => setApplyLeadershipSync(e.target.checked)}
                  className="mt-0.5 accent-[#222B3A]"
                />
                <div>
                  <p className="font-semibold text-[#1E2433]">
                    Terapkan &ldquo;{request.fullName}&rdquo; sebagai nama{' '}
                    {chosenRole?.slug === 'kepala_sekolah' ? 'Kepala Sekolah' : 'Kepala Perpustakaan'}{' '}
                    di Kop Surat &amp; Laporan PDF
                  </p>
                  <p className="text-[11px] text-[#5C5E64]">
                    {request.conflictExistingValue
                      ? `Jika tidak dicentang, Kop Surat tetap mempertahankan "${request.conflictExistingValue}".`
                      : 'Jika dicentang, nama pada Kop Surat sekolah akan otomatis diperbarui.'}
                  </p>
                </div>
              </label>
            </div>
          )}

          <TextField
            label="Catatan Keputusan (Opsional — akan terlihat pada audit & status pendaftar)"
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Contoh: Disetujui sesuai SK semester genap / Ditolak karena wali kelas masih aktif"
          />
        </div>

        {/* Final Yes / No Decision Footer (Sticky for immediate visibility) */}
        <div className="sticky -bottom-6 -mx-6 mt-2 flex flex-col-reverse gap-2 border-t border-[#E7E4DC] bg-white/95 px-6 py-3.5 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            className="!h-auto min-h-[38px] py-2 whitespace-normal text-center leading-snug"
            onClick={() =>
              void onReject({
                request,
                note: decisionNote.trim() || 'Ditolak oleh peninjau — akun tidak disimpan.',
              })
            }
          >
            <XCircle className="h-4 w-4 shrink-0" />
            <span>Tidak — Tolak (Akun Tidak Disimpan)</span>
          </Button>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Batal
            </Button>
            <Button
              type="button"
              loading={busy}
              className="!h-auto min-h-[38px] py-2 whitespace-normal text-center leading-snug"
              onClick={() =>
                void onApprove({
                  request,
                  roleId: chosenRole?.id || request.requestedRoleId,
                  roleSlug: chosenRole?.slug || request.requestedRoleSlug,
                  applyClassTeacherSync: isTeacherClassRole ? applyClassTeacherSync : false,
                  syncSchedules: isTeacherClassRole && applyClassTeacherSync ? syncSchedules : false,
                  applyLeadershipSync: isLeadershipRole ? applyLeadershipSync : false,
                  note: decisionNote.trim(),
                })
              }
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Ya — Setujui &amp; Buat Akun</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
