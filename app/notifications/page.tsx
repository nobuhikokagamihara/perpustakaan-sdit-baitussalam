'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, CheckCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';

interface NotifRow {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string;
  is_read: number;
  created_at: string;
}

export default function NotificationsPage() {
  const { user, loading: authLoading, can, refreshSession } = useAuth();
  const { showToast } = useToast();
  const canReadNotifications = can('notifications.read');
  const isStaff = Boolean(user && can('dashboard.view'));
  const [notifications, setNotifications] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/notifications', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat notifikasi.');
      setNotifications(data.notifications || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat notifikasi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !canReadNotifications) return;
    let active = true;
    gatewayFetch('/api/notifications', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat notifikasi.');
        if (active) {
          setNotifications(data.notifications || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat notifikasi.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadNotifications]);

  async function markAllRead() {
    try {
      const res = await gatewayFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal', d.error || 'Gagal memperbarui status notifikasi.');
        return;
      }
      showToast('success', 'Notifikasi diperbarui', 'Semua notifikasi ditandai sudah dibaca.');
      await refreshSession();
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  async function scanAlerts() {
    try {
      const res = await gatewayFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan_alerts' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Pemindaian gagal', d.error || 'Tidak memiliki izin memindai peringatan.');
        return;
      }
      showToast('info', 'Pemindaian selesai', `${d.generated} peringatan baru dibuat.`);
      await refreshSession();
      loadData();
    } catch (err) {
      showToast('error', 'Pemindaian gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  async function markOneRead(id: number) {
    try {
      const res = await gatewayFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal', d.error || 'Gagal menandai notifikasi.');
        return;
      }
      await refreshSession();
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  return (
    <AppShell
      title="Pusat Notifikasi"
      description="Pemberitahuan jatuh tempo, keterlambatan, reservasi tersedia, keanggotaan berakhir, dan persetujuan pengadaan."
      requiredPermission="notifications.read"
      actions={
        <>
          {isStaff && (
            <Button variant="secondary" onClick={scanAlerts}>
              <BellRing className="h-4 w-4" />
              Pindai Peringatan Terbaru
            </Button>
          )}
          <Button onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" />
            Tandai Semua Dibaca
          </Button>
        </>
      }
    >
      {loading && <LoadingState rows={5} />}
      {error && <ErrorState message={error} onRetry={loadData} />}

      {!loading && !error && notifications.length === 0 && (
        <EmptyState
          title="Belum ada notifikasi"
          description="Semua pemberitahuan sistem dan pengingat sirkulasi akan muncul di halaman ini."
        />
      )}

      {!loading && !error && notifications.length > 0 && (
        <div className="divide-y divide-[#E7E4DC] rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${
                n.is_read === 0 ? 'bg-[#EFECE3]/70' : 'bg-[#FAF9F5]'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-sm font-semibold text-slate-900">
                    {n.title}
                  </span>
                  <StatusIndicator status={n.is_read === 0 ? 'Belum Dibaca' : 'Sudah Dibaca'} />
                </div>
                <p className="text-sm text-slate-600">{n.message}</p>
                <p className="font-mono text-xs text-slate-400">{n.created_at}</p>
              </div>
              <div className="flex items-center gap-2">
                {n.link && (
                  <Link href={n.link}>
                    <Button variant="secondary" size="sm">
                      Buka Halaman
                    </Button>
                  </Link>
                )}
                {n.is_read === 0 && (
                  <Button variant="ghost" size="sm" onClick={() => markOneRead(n.id)}>
                    Tandai Dibaca
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
