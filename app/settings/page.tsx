'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Building2,
  Database,
  History,
  KeyRound,
  Scale,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorState, LoadingState } from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import {
  GeneralSettingsPanel,
  MembershipPoliciesPanel,
} from '@/components/settings/GeneralAndPoliciesTab';
import { RbacMatrixTab } from '@/components/settings/RbacMatrixTab';
import { UsersManagementTab } from '@/components/settings/UsersManagementTab';
import { AuditTrailTab } from '@/components/settings/AuditTrailTab';
import { BackupCenterTab } from '@/components/settings/BackupCenterTab';
import type { MembershipTypeRow, SettingsPayload } from '@/components/settings/types';

type SettingsTabKey = 'general' | 'policies' | 'rbac' | 'users' | 'audit' | 'backup';

const TABS: Array<{ key: SettingsTabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'general', label: 'Identitas & Aturan', icon: Building2 },
  { key: 'policies', label: 'Jenis Anggota', icon: Scale },
  { key: 'rbac', label: 'RBAC & Peran', icon: KeyRound },
  { key: 'users', label: 'Akun Pengguna', icon: Users },
  { key: 'audit', label: 'Audit Log', icon: History },
  { key: 'backup', label: 'Backup & Restore', icon: Database },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const initialTabParam = searchParams.get('tab');
  const initialTab: SettingsTabKey =
    initialTabParam && ['general', 'policies', 'rbac', 'users', 'audit', 'backup'].includes(initialTabParam)
      ? (initialTabParam as SettingsTabKey)
      : 'general';

  const { user, loading: authLoading, can, authMode, refreshSession } = useAuth();
  const { showToast } = useToast();
  const notify = useCallback(
    (msg: string, tone: 'success' | 'error' | 'info' = 'info') => {
      showToast(tone, msg);
    },
    [showToast]
  );
  const canReadSettings = can('settings.read');
  const canWrite = can('settings.write');
  const isFirebaseMode = authMode === 'firebase';

  const [tab, setTab] = useState<SettingsTabKey>(initialTab);
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [policiesDraft, setPoliciesDraft] = useState<MembershipTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettingsPayload = useCallback(async () => {
    const res = await gatewayFetch('/api/settings');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Gagal memuat pengaturan sistem.');
    return json as SettingsPayload;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchSettingsPayload();
      setData(payload);
      setSettingsDraft(payload.settings || {});
      setPoliciesDraft(payload.membershipTypes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan.');
    } finally {
      setLoading(false);
    }
  }, [fetchSettingsPayload]);

  const handleSettingsMutated = useCallback(async () => {
    await Promise.all([loadData(), refreshSession()]);
  }, [loadData, refreshSession]);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (authLoading || !userId || !canReadSettings) return;
    let active = true;
    fetchSettingsPayload()
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setSettingsDraft(payload.settings || {});
        setPoliciesDraft(payload.membershipTypes || []);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, userId, canReadSettings, fetchSettingsPayload]);

  return (
    <AppShell
      title="Pengaturan Sistem, RBAC & Backup"
      description="Kelola identitas sekolah, kebijakan sirkulasi, matriks hak akses peran, akun pengguna, jejak audit, dan pusat cadangan terverifikasi."
      requiredPermission="settings.read"
    >
      {/* Top Tab Navigation */}
      <div className="mb-5 flex items-center gap-1.5 overflow-x-auto border-b border-[#E7E4DC] pb-2.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#222B3A] text-white'
                  : 'bg-[#FAF9F5] text-[#5C5E64] border border-[#E7E4DC] hover:bg-[#EFECE3] hover:text-[#1E2433]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.key === 'users' && (() => {
                const pendingCount =
                  (data?.registrationRequests?.filter((r) => r.status === 'pending').length || 0) +
                  (data?.users?.filter((u) => u.approval_status === 'pending').length || 0);
                return pendingCount > 0 ? (
                  <span className="ml-0.5 rounded-full bg-[#E56B63] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white tabular-nums">
                    {pendingCount}
                  </span>
                ) : null;
              })()}
              {t.key === 'backup' && data?.backupSummary && (
                <span
                  className={`ml-0.5 font-mono text-[10px] tabular-nums ${
                    active ? 'text-white/80' : 'text-[#7B7D82]'
                  }`}
                >
                  ({data.backupSummary.snapshotCount})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <LoadingState rows={6} />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : data ? (
        <>
          {tab === 'general' && (
            <GeneralSettingsPanel
              settings={settingsDraft}
              onChange={setSettingsDraft}
              canWrite={canWrite}
              onSaved={handleSettingsMutated}
              notify={notify}
            />
          )}

          {tab === 'policies' && (
            <MembershipPoliciesPanel
              membershipTypes={policiesDraft}
              onChange={setPoliciesDraft}
              canWrite={canWrite}
              onSaved={handleSettingsMutated}
              notify={notify}
            />
          )}

          {tab === 'rbac' && (
            <RbacMatrixTab
              roles={data.roles}
              permissions={data.permissions}
              rolePermissions={data.rolePermissions}
              staffRoles={data.staffRoles}
              currentUserRoleSlug={user?.roleSlug}
              isFirebaseMode={isFirebaseMode}
              canWrite={canWrite}
              onSaved={handleSettingsMutated}
              notify={notify}
            />
          )}

          {tab === 'users' && (
            <UsersManagementTab
              users={data.users}
              roles={data.roles}
              registrationRequests={data.registrationRequests || []}
              schoolClasses={data.schoolClasses || []}
              currentUserId={user?.id}
              currentUserRoleSlug={user?.roleSlug}
              isFirebaseMode={isFirebaseMode}
              canWrite={canWrite}
              onSaved={handleSettingsMutated}
              notify={notify}
            />
          )}

          {tab === 'audit' && <AuditTrailTab auditLogs={data.auditLogs} notify={notify} />}

          {tab === 'backup' && (
            <BackupCenterTab
              canWrite={canWrite}
              currentUserRoleSlug={user?.roleSlug}
              onSystemMutated={handleSettingsMutated}
              notify={notify}
            />
          )}
        </>
      ) : null}
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <SettingsContent />
    </Suspense>
  );
}
