'use client';

import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  KeyRound,
  Lock,
  Minus,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Modal,
  SelectField,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import {
  PERMISSION_MODULE_META,
  SYSTEM_ROLE_SLUGS,
} from '@/lib/domain/settings-backup-rules';
import { gatewayFetch } from '@/lib/client/data-gateway';
import type { PermissionRow, RolePermissionRow, RoleRow, StaffRoleRow } from './types';

interface RbacMatrixTabProps {
  roles: RoleRow[];
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
  staffRoles?: StaffRoleRow[];
  isFirebaseMode: boolean;
  canWrite: boolean;
  onSaved: () => Promise<void>;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export function RbacMatrixTab({
  roles,
  permissions,
  rolePermissions,
  staffRoles = [],
  isFirebaseMode,
  canWrite,
  onSaved,
  notify,
}: RbacMatrixTabProps) {
  const [subView, setSubView] = useState<'editor' | 'matrix' | 'google'>('editor');
  const [selectedRoleId, setSelectedRoleId] = useState<number>(() => {
    const pustakawan = roles.find((r) => r.slug === 'pustakawan');
    return pustakawan?.id || roles[0]?.id || 1;
  });

  // Track unsaved permission edits per role
  const [draftPermIds, setDraftPermIds] = useState<number[] | null>(null);
  const [savingPerms, setSavingPerms] = useState(false);

  // Create / Edit / Delete role dialogs
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({
    name: '',
    slug: '',
    description: '',
    cloneFromRoleId: '',
  });
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [editRoleForm, setEditRoleForm] = useState({ name: '', description: '' });
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<RoleRow | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  // Firebase staff_roles assignment state
  const [staffForm, setStaffForm] = useState({
    uid: '',
    email: '',
    fullName: '',
    role: 'pustakawan',
  });
  const [staffBusy, setStaffBusy] = useState(false);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) || roles[0] || null,
    [roles, selectedRoleId]
  );

  const rolePermLookup = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const rp of rolePermissions) {
      if (!map.has(rp.role_id)) map.set(rp.role_id, new Set());
      map.get(rp.role_id)!.add(rp.permission_id);
    }
    return map;
  }, [rolePermissions]);

  const activePermIds = useMemo(() => {
    if (draftPermIds !== null) return draftPermIds;
    if (!selectedRole) return [];
    return Array.from(rolePermLookup.get(selectedRole.id) || []);
  }, [draftPermIds, selectedRole, rolePermLookup]);

  const activePermSet = useMemo(() => new Set(activePermIds), [activePermIds]);

  // Group permissions by module cleanly
  const groupedModules = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    for (const p of permissions) {
      const mod = p.module || p.code.split('.')[0] || 'other';
      if (!groups.has(mod)) groups.set(mod, []);
      groups.get(mod)!.push(p);
    }
    const orderedKeys = [
      ...Object.keys(PERMISSION_MODULE_META).filter((k) => groups.has(k)),
      ...Array.from(groups.keys()).filter((k) => !PERMISSION_MODULE_META[k]),
    ];
    return orderedKeys.map((mod) => ({
      module: mod,
      meta: PERMISSION_MODULE_META[mod] || {
        code: mod,
        label: mod.charAt(0).toUpperCase() + mod.slice(1),
        description: `Izin untuk modul ${mod}.`,
      },
      items: groups.get(mod) || [],
    }));
  }, [permissions]);

  const handleSelectRole = (roleId: number) => {
    setSelectedRoleId(roleId);
    setDraftPermIds(null);
  };

  const togglePermission = (permId: number) => {
    if (!canWrite) return;
    const next = new Set(activePermIds);
    if (next.has(permId)) next.delete(permId);
    else next.add(permId);
    setDraftPermIds(Array.from(next));
  };

  const toggleModuleAll = (items: PermissionRow[]) => {
    if (!canWrite) return;
    const ids = items.map((i) => i.id);
    const allChecked = ids.every((id) => activePermSet.has(id));
    const next = new Set(activePermIds);
    if (allChecked) {
      for (const id of ids) next.delete(id);
    } else {
      for (const id of ids) next.add(id);
    }
    setDraftPermIds(Array.from(next));
  };

  const handleSavePermissions = async () => {
    if (!selectedRole) return;
    setSavingPerms(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'role_permissions',
          roleId: selectedRole.id,
          roleSlug: selectedRole.slug,
          permissionIds: activePermIds,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan izin peran.');
      notify(`Matriks izin untuk peran "${selectedRole.name}" berhasil disimpan.`, 'success');
      setDraftPermIds(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menyimpan izin peran.', 'error');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'create_role',
          name: roleForm.name,
          slug: roleForm.slug || undefined,
          description: roleForm.description,
          cloneFromRoleId: roleForm.cloneFromRoleId ? Number(roleForm.cloneFromRoleId) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal membuat peran kustom.');
      notify(`Peran kustom "${roleForm.name}" berhasil dibuat.`, 'success');
      setCreateRoleOpen(false);
      setRoleForm({ name: '', slug: '', description: '', cloneFromRoleId: '' });
      await onSaved();
      if (json.id) {
        setSelectedRoleId(Number(json.id));
        setDraftPermIds(null);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal membuat peran.', 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const handleEditRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;
    setRoleBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'update_role',
          roleId: selectedRole.id,
          slug: selectedRole.slug,
          name: editRoleForm.name,
          description: editRoleForm.description,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memperbarui peran.');
      notify(`Peran "${editRoleForm.name}" berhasil diperbarui.`, 'success');
      setEditRoleOpen(false);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal memperbarui peran.', 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!deleteRoleTarget) return;
    setRoleBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'delete_role',
          roleId: deleteRoleTarget.id,
          slug: deleteRoleTarget.slug,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus peran.');
      notify(`Peran kustom "${deleteRoleTarget.name}" telah dihapus.`, 'success');
      setDeleteRoleTarget(null);
      setSelectedRoleId(roles[0]?.id || 1);
      setDraftPermIds(null);
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menghapus peran.', 'error');
    } finally {
      setRoleBusy(false);
    }
  };

  const handleAssignStaffRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffBusy(true);
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'assign_staff_role', ...staffForm }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menetapkan peran staf Google.');
      notify(`Peran staf Google untuk ${staffForm.email} berhasil ditetapkan.`, 'success');
      setStaffForm({ uid: '', email: '', fullName: '', role: 'pustakawan' });
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal menetapkan peran staf.', 'error');
    } finally {
      setStaffBusy(false);
    }
  };

  const handleRemoveStaffRole = async (uid: string) => {
    try {
      const res = await gatewayFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'remove_staff_role', uid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal mencabut peran staf.');
      notify('Peran staf Google berhasil dicabut.', 'success');
      await onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gagal mencabut peran staf.', 'error');
    }
  };

  const isSystemSelected = selectedRole ? SYSTEM_ROLE_SLUGS.has(selectedRole.slug) : true;
  const hasUnsavedChanges = draftPermIds !== null;

  return (
    <div className="space-y-4">
      {/* Sub-navigation + Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubView('editor')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              subView === 'editor'
                ? 'bg-[#222B3A] text-white'
                : 'text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Editor Izin Peran
          </button>
          <button
            type="button"
            onClick={() => setSubView('matrix')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              subView === 'matrix'
                ? 'bg-[#222B3A] text-white'
                : 'text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            Matriks Perbandingan RBAC
          </button>
          {isFirebaseMode && (
            <button
              type="button"
              onClick={() => setSubView('google')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                subView === 'google'
                  ? 'bg-[#222B3A] text-white'
                  : 'text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433]'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Staf Google Auth ({staffRoles.length})
            </button>
          )}
        </div>

        {canWrite && subView !== 'google' && (
          <Button size="sm" onClick={() => setCreateRoleOpen(true)}>
            <Plus className="h-4 w-4" />
            Buat Peran Kustom
          </Button>
        )}
      </div>

      {/* Sub-view 1: Module-grouped Role Permission Editor */}
      {subView === 'editor' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Role List Sidebar */}
          <div className="space-y-2 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4 lg:col-span-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#5C5E64]">
                Daftar Peran ({roles.length})
              </p>
              <span className="text-[11px] text-[#7B7D82]">Pilih untuk ubah izin</span>
            </div>

            <div className="divide-y divide-[#ECE9E1] rounded-lg border border-[#E7E4DC] bg-white">
              {roles.map((r) => {
                const isSelected = r.id === selectedRole?.id;
                const isSys = SYSTEM_ROLE_SLUGS.has(r.slug);
                const permCount = rolePermLookup.get(r.id)?.size ?? r.permission_count ?? 0;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectRole(r.id)}
                    className={`flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#222B3A] text-white' : 'hover:bg-[#F4F3EE]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{r.name}</span>
                        {isSys && (
                          <Lock
                            className={`h-3 w-3 shrink-0 ${
                              isSelected ? 'text-white/70' : 'text-[#8A8B90]'
                            }`}
                          />
                        )}
                      </div>
                      <p
                        className={`mt-0.5 truncate font-mono text-[11px] ${
                          isSelected ? 'text-white/75' : 'text-[#7B7D82]'
                        }`}
                      >
                        {r.slug}
                      </p>
                      <p
                        className={`mt-1 line-clamp-2 text-[11px] ${
                          isSelected ? 'text-white/80' : 'text-[#5C5E64]'
                        }`}
                      >
                        {r.description || 'Tidak ada deskripsi'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-white' : 'text-[#1E2433]'
                        }`}
                      >
                        {permCount}/{permissions.length}
                      </div>
                      <div
                        className={`text-[10px] ${
                          isSelected ? 'text-white/75' : 'text-[#7B7D82]'
                        }`}
                      >
                        {r.user_count ?? 0} akun
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grouped Permissions Editor */}
          <div className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 lg:col-span-8">
            {selectedRole && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E7E4DC] pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-serif text-lg font-semibold text-[#1E2433]">
                        {selectedRole.name}
                      </h3>
                      <span className="font-mono text-xs text-[#7B7D82]">{selectedRole.slug}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[#5C5E64]">
                      {selectedRole.description || 'Kelola hak akses operasional per modul untuk peran ini.'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#222B3A] tabular-nums">
                      {activePermIds.length} dari {permissions.length} izin aktif
                      {hasUnsavedChanges && (
                        <span className="ml-2 text-[#C94A43]">· Perubahan belum disimpan</span>
                      )}
                    </p>
                  </div>

                  {canWrite && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditRoleForm({
                            name: selectedRole.name,
                            description: selectedRole.description,
                          });
                          setEditRoleOpen(true);
                        }}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit Info
                      </Button>
                      {!isSystemSelected && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteRoleTarget(selectedRole)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </Button>
                      )}
                      <Button
                        size="sm"
                        loading={savingPerms}
                        onClick={handleSavePermissions}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Simpan Izin
                      </Button>
                    </div>
                  )}
                </div>

                {selectedRole.slug === 'super_admin' && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <span>
                      <strong>Proteksi Anti-Lockout Aktif:</strong> Peran{' '}
                      <code className="font-mono">super_admin</code> wajib mempertahankan izin{' '}
                      <code className="font-mono">settings.read</code> dan{' '}
                      <code className="font-mono">settings.write</code> agar administrator tidak
                      terkunci dari panel pengaturan.
                    </span>
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {groupedModules.map((group) => {
                    const checkedCount = group.items.filter((i) => activePermSet.has(i.id)).length;
                    const allChecked = checkedCount === group.items.length && group.items.length > 0;
                    return (
                      <div
                        key={group.module}
                        className="rounded-lg border border-[#E7E4DC] bg-white p-3.5"
                      >
                        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EDE5] pb-2">
                          <div>
                            <h4 className="text-xs font-semibold text-[#1E2433]">
                              {group.meta.label}
                            </h4>
                            <p className="text-[11px] text-[#7B7D82]">{group.meta.description}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[11px] text-[#5C5E64] tabular-nums">
                              {checkedCount}/{group.items.length}
                            </span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => toggleModuleAll(group.items)}
                                className="text-[11px] font-medium text-[#222B3A] underline-offset-2 hover:underline cursor-pointer"
                              >
                                {allChecked ? 'Hapus Semua' : 'Pilih Semua'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {group.items.map((perm) => {
                            const checked = activePermSet.has(perm.id);
                            const lockedForAdmin =
                              selectedRole.slug === 'super_admin' &&
                              (perm.code === 'settings.read' || perm.code === 'settings.write');
                            return (
                              <label
                                key={perm.id}
                                className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs transition-colors ${
                                  checked
                                    ? 'border-[#222B3A]/30 bg-[#FAF9F5]'
                                    : 'border-[#ECE9E1] bg-white'
                                } ${canWrite && !lockedForAdmin ? 'cursor-pointer hover:border-[#CFCAC0]' : 'opacity-80'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canWrite || lockedForAdmin}
                                  onChange={() => togglePermission(perm.id)}
                                  className="mt-0.5 h-4 w-4 rounded border-[#CFCAC0] accent-[#222B3A]"
                                />
                                <div className="min-w-0">
                                  <div className="font-medium text-[#1E2433]">{perm.name}</div>
                                  <div className="font-mono text-[10px] text-[#7B7D82]">
                                    {perm.code}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sub-view 2: Full RBAC Role x Permission Overview Matrix */}
      {subView === 'matrix' && (
        <div className="overflow-x-auto rounded-xl border border-[#E7E4DC] bg-[#FAF9F5]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                <th className="sticky left-0 bg-[#F4F3EE] px-4 py-3 font-semibold">
                  Modul &amp; Kode Izin
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                    <div>{r.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] font-normal text-[#7B7D82] tabular-nums">
                      {rolePermLookup.get(r.id)?.size ?? 0}/{permissions.length}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE9E1]">
              {groupedModules.map((group) => (
                <React.Fragment key={group.module}>
                  <tr className="bg-[#EFECE3]/60">
                    <td
                      colSpan={roles.length + 1}
                      className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#222B3A]"
                    >
                      {group.meta.label}
                    </td>
                  </tr>
                  {group.items.map((perm) => (
                    <tr key={perm.id} className="bg-white hover:bg-[#FAF9F5]">
                      <td className="sticky left-0 bg-inherit px-4 py-2.5">
                        <div className="font-medium text-[#1E2433]">{perm.name}</div>
                        <div className="font-mono text-[10px] text-[#7B7D82]">{perm.code}</div>
                      </td>
                      {roles.map((r) => {
                        const granted = rolePermLookup.get(r.id)?.has(perm.id) ?? false;
                        return (
                          <td key={r.id} className="px-3 py-2.5 text-center">
                            {granted ? (
                              <span
                                title={`${r.name}: Diizinkan`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            ) : (
                              <span
                                title={`${r.name}: Tidak diizinkan`}
                                className="inline-flex h-6 w-6 items-center justify-center text-[#CFCAC0]"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sub-view 3: Google Auth staff_roles registry (Firebase Cloud Mode) */}
      {subView === 'google' && isFirebaseMode && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <form
            onSubmit={handleAssignStaffRole}
            className="space-y-3 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-5 lg:col-span-5"
          >
            <h3 className="font-serif text-base font-semibold text-[#1E2433]">
              Tetapkan Peran Staf Google
            </h3>
            <p className="text-xs text-[#5C5E64]">
              Akun Google terverifikasi yang terdaftar di koleksi{' '}
              <code className="font-mono">staff_roles</code> akan memperoleh hak akses staf di
              Cloud Firestore.
            </p>
            <TextField
              label="UID Firebase Pengguna"
              placeholder="Contoh: AbCdEf123456"
              value={staffForm.uid}
              onChange={(e) => setStaffForm((s) => ({ ...s, uid: e.target.value }))}
              required
            />
            <TextField
              label="Email Google Terverifikasi"
              type="email"
              placeholder="pustakawan@sekolah.sch.id"
              value={staffForm.email}
              onChange={(e) => setStaffForm((s) => ({ ...s, email: e.target.value }))}
              required
            />
            <TextField
              label="Nama Lengkap Staf"
              placeholder="Nama Lengkap"
              value={staffForm.fullName}
              onChange={(e) => setStaffForm((s) => ({ ...s, fullName: e.target.value }))}
              required
            />
            <SelectField
              label="Peran Staf"
              value={staffForm.role}
              onChange={(e) => setStaffForm((s) => ({ ...s, role: e.target.value }))}
            >
              <option value="pustakawan">Pustakawan / Petugas</option>
              <option value="kepala_perpustakaan">Kepala Perpustakaan</option>
              <option value="super_admin">Super Admin</option>
              <option value="anggota">Siswa / Guru (Anggota)</option>
            </SelectField>
            <Button type="submit" loading={staffBusy} className="w-full">
              Simpan Peran Staf Google
            </Button>
          </form>

          <div className="overflow-x-auto rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] lg:col-span-7">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-[11px] uppercase tracking-wider text-[#5C5E64]">
                  <th className="px-4 py-3 font-semibold">Nama &amp; Email</th>
                  <th className="px-4 py-3 font-semibold">UID</th>
                  <th className="px-4 py-3 font-semibold">Peran</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9E1]">
                {staffRoles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#7B7D82]">
                      Belum ada penetapan peran staf tambahan di Cloud Firestore.
                    </td>
                  </tr>
                ) : (
                  staffRoles.map((sr) => (
                    <tr key={sr.uid} className="bg-white">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#1E2433]">{sr.fullName}</div>
                        <div className="text-[11px] text-[#5C5E64]">{sr.email}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#5C5E64]">{sr.uid}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#1E2433]">{sr.role}</td>
                      <td className="px-4 py-3">
                        <StatusIndicator status={sr.isActive ? 'Aktif' : 'Nonaktif'} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveStaffRole(sr.uid)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-[#C94A43]" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create Custom Role */}
      <Modal
        open={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        title="Buat Peran Kustom Baru"
        description="Tambahkan peran khusus (mis. Guru Pendamping Literasi atau Auditor Inventaris) dan salin izin awal bila perlu."
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleCreateRole} className="space-y-4">
          <TextField
            label="Nama Peran"
            placeholder="Contoh: Koordinator Literasi Kelas"
            value={roleForm.name}
            onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <TextField
            label="Slug Teknis (Opsional — Otomatis dari Nama)"
            placeholder="koordinator_literasi"
            value={roleForm.slug}
            onChange={(e) => setRoleForm((f) => ({ ...f, slug: e.target.value }))}
          />
          <TextField
            label="Deskripsi Tugas & Tanggung Jawab"
            placeholder="Mengelola jadwal baca kelas dan laporan kehadiran literasi."
            value={roleForm.description}
            onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
          />
          <SelectField
            label="Salin Izin Awal dari Peran (Opsional)"
            value={roleForm.cloneFromRoleId}
            onChange={(e) => setRoleForm((f) => ({ ...f, cloneFromRoleId: e.target.value }))}
          >
            <option value="">Kosongkan (Atur manual setelah dibuat)</option>
            {roles.map((r) => (
              <option key={r.id} value={String(r.id)}>
                Salin dari {r.name} ({rolePermLookup.get(r.id)?.size ?? 0} izin)
              </option>
            ))}
          </SelectField>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setCreateRoleOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={roleBusy}>
              Buat Peran Kustom
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit Role Metadata */}
      <Modal
        open={editRoleOpen}
        onClose={() => setEditRoleOpen(false)}
        title={`Edit Informasi Peran — ${selectedRole?.slug || ''}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleEditRole} className="space-y-4">
          <TextField
            label="Nama Peran"
            value={editRoleForm.name}
            onChange={(e) => setEditRoleForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <TextField
            label="Deskripsi Peran"
            value={editRoleForm.description}
            onChange={(e) => setEditRoleForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setEditRoleOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={roleBusy}>
              Simpan Perubahan
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirm Delete Custom Role */}
      <ConfirmDialog
        open={Boolean(deleteRoleTarget)}
        onClose={() => setDeleteRoleTarget(null)}
        onConfirm={handleDeleteRole}
        title="Hapus Peran Kustom?"
        message={`Peran "${deleteRoleTarget?.name}" akan dihapus permanen beserta konfigurasi izinnya. Hanya peran yang tidak memiliki akun aktif yang dapat dihapus.`}
        confirmLabel="Hapus Peran"
        variant="danger"
        loading={roleBusy}
      />
    </div>
  );
}
