'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  KeyRound,
  Scale,
  School,
  Shield,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Modal,
  SearchField,
  SelectField,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { canRoleApproveRegistrations } from '@/lib/domain/signup-rules';
import { RegistrationReviewModal } from './RegistrationReviewModal';
import type {
  RegistrationRequestRow,
  RoleRow,
  SchoolClassSummaryRow,
  UserRow,
} from './types';

interface UsersManagementTabProps {
  users: UserRow[];
  roles: RoleRow[];
  registrationRequests?: RegistrationRequestRow[];
  schoolClasses?: SchoolClassSummaryRow[];
  currentUserId?: number;
  currentUserRoleSlug?: string;
  isFirebaseMode: boolean;
  canWrite: boolean;
  onSaved: () => Promise<void>;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export function UsersManagementTab({
  users,
  roles,
  registrationRequests = [],
  schoolClasses = [],
  currentUserId,
  currentUserRoleSlug,
  isFirebaseMode,
  canWrite,
  onSaved,
  notify,
}: UsersManagementTabProps) {
  const isSuperAdmin = currentUserRoleSlug === 'super_admin';
  const canApproveRegistrations = canRoleApproveRegistrations(currentUserRoleSlug);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'pending' | 'rejected' | 'inactive'
  >('all');

  // Pending approvals state
  const [reviewTarget, setReviewTarget] = useState<RegistrationRequestRow | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [showRequestHistory, setShowRequestHistory] = useState(false);

  // Legacy pending users override map
  const [approvalRoleByKey, setApprovalRoleByKey] = useState<Record<string, string>>({});
  const [approvalBusyKey, setApprovalBusyKey] = useState<string | null>(null);

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
    roleId: String(roles.find((r) => r.slug === 'pustakawan')?.id || roles[0]?.id || 3),
    assignedClass: '',
    syncToClass: false,
  });

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ fullName: '', email: '', roleId: '' });

  const [roleChangeTarget, setRoleChangeTarget] = useState<UserRow | null>(null);
  const [roleChangeId, setRoleChangeId] = useState('');

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [busy, setBusy] = useState(false);

  const groupedRoles = useMemo(() => {
    const groups = new Map<string, RoleRow[]>();
    for (const r of roles) {
      const cat = r.category || 'Warga Sekolah';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(r);
    }
    return Array.from(groups.entries());
  }, [roles]);

  const pendingRequests = useMemo(
    () => registrationRequests.filter((r) => r.status === 'pending'),
    [registrationRequests]
  );

  const resolvedRequests = useMemo(
    () => registrationRequests.filter((r) => r.status !== 'pending').slice(0, 15),
    [registrationRequests]
  );

  const pendingUsers = useMemo(
    () => users.filter((u) => u.approval_status === 'pending'),
    [users]
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const appStatus = u.approval_status || 'approved';
      if (roleFilter !== 'all' && u.role_slug !== roleFilter) return false;
      if (statusFilter === 'pending' && appStatus !== 'pending') return false;
      if (statusFilter === 'rejected' && appStatus !== 'rejected') return false;
      if (statusFilter === 'active' && (!u.is_active || appStatus !== 'approved')) return false;
      if (
        statusFilter === 'inactive' &&
        (u.is_active || appStatus === 'pending' || appStatus === 'rejected')
      )
        return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role_name.toLowerCase().includes(q) ||
        (u.assigned_class || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const selectedCreateRole = useMemo(
    () => roles.find((r) => String(r.id) === createForm.roleId),
    [roles, createForm.roleId]
  );

  const createNeedsClass =
    selectedCreateRole &&
    ['siswa', 'duta_literasi', 'wali_kelas', 'guru_pendamping'].includes(selectedCreateRole.slug);
  const createIsClassTeacher =
    selectedCreateRole &&
    ['wali_kelas', 'guru_pendamping'].includes(selectedCreateRole.slug);

  const renderUserStatus = (u: UserRow) => {
    if (u.approval_status === 'pending') return 'Menunggu Persetujuan';
    if (u.approval_status === 'rejected') return 'Ditolak';
    return u.is_active ? 'Aktif' : 'Nonaktif';
  };

  const handleApproveRegistration = async (opts: {
    request: RegistrationRequestRow;
    roleId: number;
    roleSlug: string;
    applyClassTeacherSync: boolean;
    syncSchedules: boolean;
    applyLeadershipSync: boolean;
    note: string;
  }) => {
    setReviewBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'approve_registration',
          requestId: opts.request.id,
          docId: opts.request.docId,
          requesterUid: opts.request.requesterUid,
          roleId: opts.roleId,
          roleSlug: opts.roleSlug,
          applyClassTeacherSync: opts.applyClassTeacherSync,
          syncSchedules: opts.syncSchedules,
          applyLeadershipSync: opts.applyLeadershipSync,
          note: opts.note,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyetujui pendaftaran.');
      const syncMsg = opts.applyClassTeacherSync
        ? ` Data kelas ${opts.request.assignedClass}${opts.syncSchedules ? ' & jadwal baca' : ''} diperbarui.`
        : opts.request.hasConflict && opts.request.assignedClass
          ? ` Data kelas ${opts.request.assignedClass} eksisting tetap dipertahankan.`
          : '';
      notify(`Pendaftaran "${opts.request.fullName}" disetujui dan akun berhasil dibuat.${syncMsg}`, 'success');
      setReviewTarget(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyetujui pendaftaran.', 'error');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleRejectRegistration = async (opts: {
    request: RegistrationRequestRow;
    note: string;
  }) => {
    setReviewBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'reject_registration',
          requestId: opts.request.id,
          docId: opts.request.docId,
          requesterUid: opts.request.requesterUid,
          note: opts.note,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menolak pendaftaran.');
      notify(
        `Pendaftaran "${opts.request.fullName}" (${opts.request.requestCode}) ditolak. Akun tidak disimpan dan data kelas tidak diubah.`,
        'info'
      );
      setReviewTarget(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menolak pendaftaran.', 'error');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'create_user',
          fullName: createForm.fullName,
          username: createForm.username,
          email: createForm.email,
          password: createForm.password,
          roleId: Number(createForm.roleId),
          assignedClass: createForm.assignedClass,
          syncToClass: createForm.syncToClass,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal membuat akun baru.');
      notify(`Akun "${createForm.fullName}" berhasil ditambahkan.`, 'success');
      setCreateOpen(false);
      setCreateForm({
        fullName: '',
        username: '',
        email: '',
        password: '',
        roleId: String(roles.find((r) => r.slug === 'pustakawan')?.id || 3),
        assignedClass: '',
        syncToClass: false,
      });
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal membuat akun.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setBusy(true);
    try {
      const selectedRole = roles.find((r) => String(r.id) === editForm.roleId);
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'update_user',
          userId: editTarget.id,
          uid: editTarget.uid,
          fullName: editForm.fullName,
          email: editForm.email,
          roleId: Number(editForm.roleId),
          roleSlug: selectedRole?.slug,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memperbarui akun.');
      notify(`Data dan peran akun "${editForm.fullName}" berhasil diperbarui.`, 'success');
      setEditTarget(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal memperbarui akun.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleChangeUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleChangeTarget) return;
    setBusy(true);
    try {
      const targetRole = roles.find((r) => String(r.id) === roleChangeId);
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'change_user_role',
          userId: roleChangeTarget.id,
          uid: roleChangeTarget.uid,
          roleId: Number(roleChangeId),
          roleSlug: targetRole?.slug,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mengganti peran akun.');
      notify(
        `Peran akun "${roleChangeTarget.full_name}" berhasil diubah menjadi ${targetRole?.name || 'peran baru'}.`,
        'success'
      );
      setRoleChangeTarget(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mengganti peran akun.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveUser = async (u: UserRow) => {
    const key = u.uid || String(u.id);
    const chosenRoleId = Number(
      approvalRoleByKey[key] || u.requested_role_id || u.role_id
    );
    const chosenRole = roles.find((r) => r.id === chosenRoleId);
    setApprovalBusyKey(key);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'approve_user',
          userId: u.id,
          uid: u.uid,
          roleId: chosenRoleId,
          roleSlug: chosenRole?.slug,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyetujui akun.');
      notify(
        `Akun "${u.full_name}" disetujui sebagai ${chosenRole?.name || u.role_name}.`,
        'success'
      );
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyetujui akun.', 'error');
    } finally {
      setApprovalBusyKey(null);
    }
  };

  const handleRejectUser = async (u: UserRow) => {
    const key = u.uid || String(u.id);
    setApprovalBusyKey(key);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'reject_user',
          userId: u.id,
          uid: u.uid,
          note: 'Ditolak oleh peninjau',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menolak akun.');
      notify(`Pendaftaran akun "${u.full_name}" ditolak.`, 'info');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menolak akun.', 'error');
    } finally {
      setApprovalBusyKey(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'reset_password',
          userId: resetTarget.id,
          newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mereset kata sandi.');
      notify(`Kata sandi untuk @${resetTarget.username} berhasil diperbarui.`, 'success');
      setResetTarget(null);
      setNewPassword('');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mereset kata sandi.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (u: UserRow) => {
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'toggle_user',
          userId: u.id,
          uid: u.uid,
          isActive: !u.is_active,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah status akun.');
      notify(
        `Akun ${u.full_name} berhasil ${u.is_active ? 'dinonaktifkan' : 'diaktifkan kembali'}.`,
        'success'
      );
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mengubah status akun.', 'error');
    }
  };

  const renderRoleOptions = () =>
    groupedRoles.map(([category, items]) => (
      <optgroup key={category} label={category}>
        {items.map((r) => (
          <option key={r.id} value={String(r.id)}>
            {r.name} ({r.slug})
          </option>
        ))}
      </optgroup>
    ));

  return (
    <div className="space-y-4">
      {/* Pending Registration & Conflict Resolution Queue (Super Admin / Admin Perpus / Kepala Perpus) */}
      {(pendingRequests.length > 0 || resolvedRequests.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/75 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-amber-800" />
              <h3 className="font-serif text-sm font-semibold text-amber-950">
                Antrean Persetujuan &amp; Resolusi Konflik Akun ({pendingRequests.length} Pending)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-amber-900">
                Wewenang: Super Admin, Admin Perpustakaan &amp; Kepala Perpustakaan
              </span>
              {resolvedRequests.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowRequestHistory((v) => !v)}
                >
                  {showRequestHistory
                    ? 'Sembunyikan Riwayat'
                    : `Riwayat Keputusan (${resolvedRequests.length})`}
                </Button>
              )}
            </div>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="rounded-lg border border-amber-200/80 bg-white px-4 py-3 text-xs text-[#5C5E64]">
              Tidak ada permintaan pendaftaran yang menunggu persetujuan saat ini.
            </div>
          ) : (
            <div className="divide-y divide-amber-200/80 rounded-lg border border-amber-200 bg-white">
              {pendingRequests.map((req) => (
                <div
                  key={req.docId || req.id}
                  className="flex flex-col gap-3 px-4 py-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#1E2433]">{req.fullName}</span>
                      <span className="font-mono text-[11px] text-[#5C5E64]">
                        {req.requestCode}
                      </span>
                      {req.hasConflict ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-950">
                          <AlertTriangle className="h-3 w-3" />
                          Konflik Data
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
                          <Clock className="h-3 w-3" />
                          Menunggu Verifikasi
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#5C5E64]">
                      <span className="font-mono">@{req.username}</span> · {req.email}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                      <span className="text-[#1E2433]">
                        Peran: <strong>{req.requestedRoleName}</strong>
                      </span>
                      {req.assignedClass && (
                        <span className="inline-flex items-center gap-1 text-[#1E2433]">
                          <School className="h-3 w-3 text-[#E56B63]" />
                          <strong>{req.assignedClass}</strong>
                        </span>
                      )}
                      {req.conflictExistingValue && (
                        <span className="text-amber-800">
                          Saat ini: <strong>{req.conflictExistingValue}</strong>
                        </span>
                      )}
                    </div>
                    {req.conflictSummary && (
                      <p className="text-[11px] text-amber-900/90 leading-relaxed">
                        {req.conflictSummary}
                      </p>
                    )}
                  </div>

                  {canApproveRegistrations && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setReviewTarget(req)}
                      >
                        <Scale className="h-3.5 w-3.5" />
                        Tinjau &amp; Putuskan
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showRequestHistory && resolvedRequests.length > 0 && (
            <div className="rounded-lg border border-[#E2DFD7] bg-white overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[10px] uppercase tracking-wider text-[#5C5E64]">
                    <th className="px-3 py-2">Kode</th>
                    <th className="px-3 py-2">Pendaftar</th>
                    <th className="px-3 py-2">Peran / Kelas</th>
                    <th className="px-3 py-2">Keputusan</th>
                    <th className="px-3 py-2">Peninjau</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E1]">
                  {resolvedRequests.map((r) => (
                    <tr key={`hist-${r.docId || r.id}`}>
                      <td className="px-3 py-2 font-mono text-[#1E2433]">{r.requestCode}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-[#1E2433]">{r.fullName}</div>
                        <div className="text-[#7B7D82]">{r.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{r.requestedRoleName}</div>
                        {r.assignedClass && (
                          <div className="text-[#7B7D82]">{r.assignedClass}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusIndicator
                          status={r.status === 'approved' ? 'Aktif' : 'Ditolak'}
                        />
                        {r.decisionNote && (
                          <p className="mt-0.5 text-[10px] text-[#5C5E64]">{r.decisionNote}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#5C5E64]">
                        {r.reviewedByName || 'Pengelola'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Legacy Pending Approval Queue */}
      {pendingUsers.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/75 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-700" />
              <h3 className="font-serif text-sm font-semibold text-amber-950">
                Akun Menunggu Aktivasi ({pendingUsers.length})
              </h3>
            </div>
          </div>

          <div className="divide-y divide-amber-200/80 rounded-lg border border-amber-200 bg-white">
            {pendingUsers.map((u) => {
              const key = u.uid || String(u.id);
              const selectedRoleId =
                approvalRoleByKey[key] || String(u.requested_role_id || u.role_id);
              const rowBusy = approvalBusyKey === key;
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1E2433]">{u.full_name}</p>
                    <p className="text-[11px] text-[#5C5E64]">
                      <span className="font-mono">@{u.username}</span> · {u.email}
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-800">
                      Meminta peran: <strong>{u.requested_role_name || u.role_name}</strong>
                    </p>
                  </div>

                  {canApproveRegistrations && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Pilih peran persetujuan untuk ${u.full_name}`}
                        value={selectedRoleId}
                        onChange={(e) =>
                          setApprovalRoleByKey((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="h-9 rounded-lg border border-[#E2DFD7] bg-white px-2.5 text-xs text-[#1E2433]"
                      >
                        {renderRoleOptions()}
                      </select>
                      <Button
                        size="sm"
                        loading={rowBusy}
                        onClick={() => handleApproveUser(u)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Setujui
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={rowBusy}
                        onClick={() => handleRejectUser(u)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Tolak
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Cari nama, username, email, kelas..."
            ariaLabel="Cari akun pengguna"
            className="w-64"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter peran"
            className="h-10 rounded-xl border border-[#E2DFD7] bg-white px-3 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
          >
            <option value="all">Semua Peran</option>
            {roles.map((r) => (
              <option key={r.id} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as 'all' | 'active' | 'pending' | 'rejected' | 'inactive'
              )
            }
            aria-label="Filter status akun"
            className="h-10 rounded-xl border border-[#E2DFD7] bg-white px-3 text-xs text-[#1E2433] focus:border-[#222B3A] focus:outline-none"
          >
            <option value="all">Semua Status</option>
            <option value="active">Aktif</option>
            <option value="pending">Menunggu Persetujuan</option>
            <option value="rejected">Ditolak</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[#5C5E64] tabular-nums">
            Menampilkan {filteredUsers.length} dari {users.length} akun
          </span>
          {isSuperAdmin && canWrite && !isFirebaseMode && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Tambah Akun
            </Button>
          )}
        </div>
      </div>

      {/* Users Table */}
      {filteredUsers.length === 0 ? (
        <EmptyState
          title="Tidak ada akun yang cocok"
          description="Ubah kata kunci pencarian atau filter peran/status untuk melihat daftar akun pengguna."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                <th className="px-4 py-3 font-semibold">Nama Lengkap</th>
                <th className="px-4 py-3 font-semibold">Username &amp; Email</th>
                <th className="px-4 py-3 font-semibold">Peran RBAC</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE9E1]">
              {filteredUsers.map((u) => {
                const isSelf = currentUserId !== undefined && u.id === currentUserId;
                const isPending = u.approval_status === 'pending';
                return (
                  <tr key={u.uid || u.id} className="bg-white hover:bg-[#FAF9F5]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#1E2433]">{u.full_name}</span>
                        {isSelf && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#E56B63]">
                            (Anda)
                          </span>
                        )}
                      </div>
                      {u.assigned_class && (
                        <div className="mt-0.5 text-[11px] text-[#5C5E64]">
                          Kelas: <strong>{u.assigned_class}</strong>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-[#1E2433]">@{u.username}</div>
                      <div className="text-[11px] text-[#5C5E64]">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#1E2433]">{u.role_name}</div>
                      <div className="font-mono text-[10px] text-[#7B7D82]">{u.role_slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={renderUserStatus(u)} />
                    </td>
                    <td className="px-4 py-3">
                      {canWrite && (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canApproveRegistrations && isPending && (
                            <Button
                              size="sm"
                              onClick={() => handleApproveUser(u)}
                              loading={approvalBusyKey === (u.uid || String(u.id))}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Setujui
                            </Button>
                          )}
                          {isSuperAdmin && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isSelf && u.role_slug === 'super_admin'}
                              onClick={() => {
                                setRoleChangeTarget(u);
                                setRoleChangeId(String(u.role_id));
                              }}
                            >
                              <Shield className="h-3.5 w-3.5 text-[#E56B63]" />
                              Ganti Peran
                            </Button>
                          )}
                          {!isFirebaseMode && isSuperAdmin && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setEditTarget(u);
                                  setEditForm({
                                    fullName: u.full_name,
                                    email: u.email,
                                    roleId: String(u.role_id),
                                  });
                                }}
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setResetTarget(u);
                                  setNewPassword('');
                                }}
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                                Sandi
                              </Button>
                            </>
                          )}
                          {!isPending && (
                            <Button
                              size="sm"
                              variant={u.is_active ? 'ghost' : 'secondary'}
                              disabled={isSelf}
                              onClick={() => handleToggleActive(u)}
                            >
                              {u.is_active ? (
                                <>
                                  <UserX className="h-3.5 w-3.5 text-[#C94A43]" />
                                  Nonaktifkan
                                </>
                              ) : (
                                <>
                                  <UserCheck className="h-3.5 w-3.5 text-emerald-700" />
                                  Aktifkan
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isFirebaseMode && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] px-4 py-3 text-xs text-[#5C5E64]">
          <Users className="h-4 w-4 shrink-0 text-[#222B3A]" />
          <span>
            Pada mode Cloud Firebase, antrean pendaftaran berstatus <strong>Pending</strong>{' '}
            tersimpan di koleksi Firestore <code className="font-mono">registration_requests</code>{' '}
            dan dapat diputuskan oleh Super Admin, Admin Perpustakaan, maupun Kepala Perpustakaan.
          </span>
        </div>
      )}

      {/* Modal: Registration Conflict Review */}
      <RegistrationReviewModal
        request={reviewTarget}
        roles={roles}
        currentUserRoleSlug={currentUserRoleSlug}
        busy={reviewBusy}
        onClose={() => setReviewTarget(null)}
        onApprove={handleApproveRegistration}
        onReject={handleRejectRegistration}
      />

      {/* Modal: Create User */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Akun Pengguna Baru"
        description="Buat kredensial login baru dan tetapkan peran RBAC warga sekolah yang sesuai."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Nama Lengkap"
              value={createForm.fullName}
              onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
              required
            />
            <TextField
              label="Username"
              placeholder="pustakawan_2"
              value={createForm.username}
              onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
              required
            />
            <TextField
              label="Email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
            <TextField
              label="Kata Sandi Awal (Min. 8 karakter, huruf & angka)"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
            <SelectField
              label="Peran RBAC"
              value={createForm.roleId}
              onChange={(e) =>
                setCreateForm((f) => ({
                  ...f,
                  roleId: e.target.value,
                  assignedClass: '',
                  syncToClass: false,
                }))
              }
              className="sm:col-span-2"
            >
              {renderRoleOptions()}
            </SelectField>

            {createNeedsClass && schoolClasses.length > 0 && (
              <SelectField
                label="Pilih Kelas Rombel"
                value={createForm.assignedClass}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, assignedClass: e.target.value }))
                }
                className="sm:col-span-2"
              >
                <option value="">-- Pilih Kelas --</option>
                {schoolClasses.map((c) => (
                  <option key={c.className} value={c.className}>
                    {c.className}
                    {createIsClassTeacher
                      ? ` — Wali: ${c.homeroomTeacher || 'Kosong'} | Pendamping: ${c.companionTeacher || 'Kosong'}`
                      : ''}
                  </option>
                ))}
              </SelectField>
            )}

            {createIsClassTeacher && createForm.assignedClass && (
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-[#1E2433] cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.syncToClass}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, syncToClass: e.target.checked }))
                  }
                  className="accent-[#222B3A]"
                />
                Langsung sinkronkan nama ini ke data {createForm.assignedClass} &amp; jadwal baca aktif
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={busy}>
              Simpan Akun Baru
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Quick Change Role (Super Admin) */}
      <Modal
        open={Boolean(roleChangeTarget)}
        onClose={() => setRoleChangeTarget(null)}
        title={`Ganti Peran Akun — ${roleChangeTarget?.full_name || ''}`}
        description={`Peran saat ini: ${roleChangeTarget?.role_name || ''} (@${roleChangeTarget?.username || ''})`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleChangeUserRole} className="space-y-4">
          <SelectField
            label="Pilih Peran Baru"
            value={roleChangeId}
            onChange={(e) => setRoleChangeId(e.target.value)}
          >
            {renderRoleOptions()}
          </SelectField>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setRoleChangeTarget(null)}>
              Batal
            </Button>
            <Button type="submit" loading={busy}>
              Simpan Peran Baru
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit User & Change Role */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={`Edit Akun — @${editTarget?.username || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleEditUser} className="space-y-4">
          <TextField
            label="Nama Lengkap"
            value={editForm.fullName}
            onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
            required
          />
          <TextField
            label="Email"
            type="email"
            value={editForm.email}
            onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
          <SelectField
            label="Peran RBAC"
            value={editForm.roleId}
            onChange={(e) => setEditForm((f) => ({ ...f, roleId: e.target.value }))}
          >
            {renderRoleOptions()}
          </SelectField>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>
              Batal
            </Button>
            <Button type="submit" loading={busy}>
              Simpan Perubahan
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Reset Password */}
      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title={`Reset Kata Sandi — @${resetTarget?.username || ''}`}
        description="Kata sandi baru akan di-hash menggunakan scrypt dan aktivitas dicatat di Audit Log."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <TextField
            label="Kata Sandi Baru (Min. 8 karakter, kombinasi huruf & angka)"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>
              Batal
            </Button>
            <Button type="submit" loading={busy}>
              Perbarui Kata Sandi
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
