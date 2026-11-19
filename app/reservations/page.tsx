'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, XCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
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

interface ReservationRow {
  id: number;
  reservation_number: string;
  book_id: number;
  book_title: string;
  isbn: string;
  member_code: string;
  member_name: string;
  inventory_code: string | null;
  queue_position: number;
  status: string;
  reserved_at: string;
  expires_at: string | null;
  notes: string;
}

export default function ReservationsPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadReservations = can('reservations.read');
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [books, setBooks] = useState<Array<{ id: number; title: string }>>([]);
  const [members, setMembers] = useState<Array<{ id: number; member_code: string; full_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [bookId, setBookId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/reservations', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat reservasi.');
      setReservations(data.reservations || []);

      const catRes = await gatewayFetch('/api/catalog', { cache: 'no-store' });
      if (catRes.ok) {
        const cd = await catRes.json();
        setBooks((cd.books || []).map((b: { id: number; title: string }) => ({ id: b.id, title: b.title })));
        if (cd.books?.length && !bookId) setBookId(String(cd.books[0].id));
      }

      if (can('members.read')) {
        const memRes = await gatewayFetch('/api/members', { cache: 'no-store' });
        if (memRes.ok) {
          const md = await memRes.json();
          setMembers(md.members || []);
          if (md.members?.length && !memberId) setMemberId(String(md.members[0].id));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat reservasi.');
    } finally {
      setLoading(false);
    }
  }, [can, bookId, memberId]);

  useEffect(() => {
    if (authLoading || !user || !canReadReservations) return;
    let active = true;
    gatewayFetch('/api/reservations', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat reservasi.');
        if (active) {
          setReservations(data.reservations || []);
          setError(null);
        }

        const catRes = await gatewayFetch('/api/catalog', { cache: 'no-store' });
        if (active && catRes.ok) {
          const cd = await catRes.json();
          setBooks(
            (cd.books || []).map((b: { id: number; title: string }) => ({ id: b.id, title: b.title }))
          );
          if (cd.books?.length) {
            setBookId((prev) => prev || String(cd.books[0].id));
          }
        }

        if (can('members.read')) {
          const memRes = await gatewayFetch('/api/members', { cache: 'no-store' });
          if (active && memRes.ok) {
            const md = await memRes.json();
            setMembers(md.members || []);
            if (md.members?.length) {
              setMemberId((prev) => prev || String(md.members[0].id));
            }
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat reservasi.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user, canReadReservations, can]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await gatewayFetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: Number(bookId),
          memberId: !can('members.read') ? user?.memberId : Number(memberId),
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengajukan reservasi.');
      showToast(
        'success',
        'Reservasi berhasil',
        `${data.reservationNumber} · Posisi antrean ke-${data.queuePosition}`
      );
      setCreateOpen(false);
      setNotes('');
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(reservationId: number, action: 'cancel' | 'pickup') {
    try {
      const res = await gatewayFetch('/api/reservations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservationId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal memperbarui reservasi', data.error || 'Permintaan ditolak.');
        return;
      }
      showToast('success', 'Reservasi diperbarui', action === 'cancel' ? 'Dibatalkan' : 'Diambil');
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Terjadi kesalahan jaringan.');
    }
  }

  return (
    <AppShell
      title="Antrean Reservasi Buku"
      description="Kelola antrean reservasi berdasarkan prioritas waktu pengajuan dan batas waktu pengambilan."
      requiredPermission="reservations.read"
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Ajukan Reservasi
        </Button>
      }
    >
      {loading && <LoadingState rows={5} />}
      {error && <ErrorState message={error} onRetry={loadData} />}

      {!loading && !error && reservations.length === 0 && (
        <EmptyState
          title="Belum ada antrean reservasi"
          description="Reservasi buku yang diajukan oleh anggota akan muncul sesuai urutan antrean."
          action={<Button onClick={() => setCreateOpen(true)}>Ajukan Reservasi</Button>}
        />
      )}

      {!loading && !error && reservations.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">No. Reservasi</th>
                  <th className="px-4 py-3">Judul Buku</th>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3 text-center">Antrean</th>
                  <th className="px-4 py-3">Batas Ambil</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE7DF]">
                {reservations.map((r) => (
                  <tr key={r.id} className="hover:bg-[#F4F3EE]/80">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                      {r.reservation_number}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.book_title}</p>
                      <p className="font-mono text-xs text-slate-500">
                        {r.inventory_code ? `Unit: ${r.inventory_code}` : `ISBN ${r.isbn || '-'}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{r.member_name}</p>
                      <p className="font-mono text-xs text-slate-500">{r.member_code}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs font-semibold tabular-nums">
                      #{r.queue_position}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {r.expires_at || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusIndicator status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        {r.status === 'Tersedia' && can('loans.write') && (
                          <Button size="sm" onClick={() => handleAction(r.id, 'pickup')}>
                            <CalendarClock className="h-3.5 w-3.5" />
                            Tandai Diambil
                          </Button>
                        )}
                        {(r.status === 'Menunggu' || r.status === 'Tersedia') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleAction(r.id, 'cancel')}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Batalkan
                          </Button>
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

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Ajukan Reservasi Buku" maxWidth="max-w-lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <SelectField label="Pilih Judul Buku" value={bookId} onChange={(e) => setBookId(e.target.value)}>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </SelectField>
          {can('members.read') && (
            <SelectField label="Anggota Pemesan" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.member_code} — {m.full_name}
                </option>
              ))}
            </SelectField>
          )}
          <TextField
            label="Catatan (opsional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              Simpan Reservasi
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
