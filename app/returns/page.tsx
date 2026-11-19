'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  SearchField,
  SelectField,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import {
  calculateFineAmount,
  calculateOverdueDays,
  formatCurrencyIDR,
  formatIsoDate,
  type CopyCondition,
} from '@/lib/domain/library-rules';

interface ActiveLoanItem {
  loan_item_id: number;
  loan_id: number;
  copy_id: number;
  due_date: string;
  item_status: string;
  loan_number: string;
  loan_date: string;
  member_code: string;
  member_name: string;
  daily_fine_rate: number;
  max_fine_cap: number;
  book_title: string;
  book_price: number;
  inventory_code: string;
  barcode: string;
  copy_price: number;
}

interface ReturnRecord {
  id: number;
  return_number: string;
  loan_number: string;
  member_name: string;
  book_title: string;
  inventory_code: string;
  returned_at: string;
  condition: string;
  status: string;
  overdue_days: number;
  fine_amount: number;
}

export default function ReturnsPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canProcessReturns = can('returns.write');
  const [activeItems, setActiveItems] = useState<ActiveLoanItem[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [policy, setPolicy] = useState({
    gracePeriodDays: 1,
    damageFeePercent: 50,
    lostFeePercent: 100,
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ActiveLoanItem | null>(null);
  const [condition, setCondition] = useState<CopyCondition>('Baik');
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/returns', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data pengembalian.');
      setActiveItems(data.activeItems || []);
      setReturns(data.returns || []);
      if (data.policy) {
        setPolicy({
          gracePeriodDays: Number(data.policy.gracePeriodDays ?? 1),
          damageFeePercent: Number(data.policy.damageFeePercent ?? 50),
          lostFeePercent: Number(data.policy.lostFeePercent ?? 100),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !canProcessReturns) return;
    let active = true;
    gatewayFetch('/api/returns', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data pengembalian.');
        if (active) {
          setActiveItems(data.activeItems || []);
          setReturns(data.returns || []);
          if (data.policy) {
            setPolicy({
              gracePeriodDays: Number(data.policy.gracePeriodDays ?? 1),
              damageFeePercent: Number(data.policy.damageFeePercent ?? 50),
              lostFeePercent: Number(data.policy.lostFeePercent ?? 100),
            });
          }
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canProcessReturns]);

  const filteredActive = activeItems.filter((it) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      it.barcode.toLowerCase().includes(q) ||
      it.inventory_code.toLowerCase().includes(q) ||
      it.loan_number.toLowerCase().includes(q) ||
      it.member_name.toLowerCase().includes(q) ||
      it.book_title.toLowerCase().includes(q)
    );
  });

  const today = formatIsoDate(new Date());
  const previewOverdue = selected
    ? calculateOverdueDays(selected.due_date, today, policy.gracePeriodDays)
    : 0;
  const previewFine = selected
    ? calculateFineAmount({
        overdueDays: previewOverdue,
        dailyRate: selected.daily_fine_rate,
        maxCap: selected.max_fine_cap,
        condition,
        bookPrice: selected.copy_price || selected.book_price || 100000,
        damageFeePercent: policy.damageFeePercent,
        lostFeePercent: policy.lostFeePercent,
      })
    : { lateFine: 0, damageFine: 0, totalFine: 0 };

  async function handleConfirmReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setProcessing(true);
    try {
      const res = await gatewayFetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanItemId: selected.loan_item_id,
          condition,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memproses pengembalian.');

      showToast(
        'success',
        `Pengembalian ${data.returnNumber}`,
        data.totalFine > 0
          ? `Status: ${data.returnStatus} · Denda tercatat: ${formatCurrencyIDR(data.totalFine)}`
          : `Status: ${data.returnStatus} · Eksemplar kini ${data.newCopyStatus}`
      );
      setSelected(null);
      setCondition('Baik');
      setNotes('');
      loadData();
    } catch (err) {
      showToast('error', 'Pengembalian gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <AppShell
      title="Pengembalian Buku"
      description="Pindai barcode atau cari peminjaman aktif untuk menghitung keterlambatan, memeriksa kondisi fisik, dan memperbarui stok."
      requiredPermission="returns.write"
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-4">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Scan barcode, kode inventaris, nomor pinjam, atau nama anggota..."
            ariaLabel="Cari peminjaman aktif untuk pengembalian"
          />
        </div>

        {loading && <LoadingState rows={5} />}
        {error && <ErrorState message={error} onRetry={loadData} />}

        {!loading && !error && (
          <>
            <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
              <div className="border-b border-[#E7E4DC] px-5 py-4">
                <h2 className="font-serif text-base font-semibold text-slate-900">
                  Buku Sedang Dipinjam ({filteredActive.length})
                </h2>
              </div>
              {filteredActive.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="Tidak ada item pinjaman aktif yang cocok"
                    description="Semua buku yang sesuai pencarian sudah dikembalikan."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Kode / Barcode</th>
                        <th className="px-4 py-3">Judul Buku</th>
                        <th className="px-4 py-3">Peminjam</th>
                        <th className="px-4 py-3">Jatuh Tempo</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE7DF]">
                      {filteredActive.map((it) => (
                        <tr key={it.loan_item_id} className="hover:bg-[#F4F3EE]/80">
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs font-semibold text-slate-900">
                              {it.inventory_code}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">{it.barcode}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{it.book_title}</p>
                            <p className="font-mono text-xs text-slate-500">{it.loan_number}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-900">{it.member_name}</p>
                            <p className="font-mono text-xs text-slate-500">{it.member_code}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs tabular-nums">
                            {it.due_date}
                          </td>
                          <td className="px-4 py-3">
                            <StatusIndicator status={it.item_status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelected(it);
                                setCondition('Baik');
                                setNotes('');
                              }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Proses Kembali
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Return History */}
            <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
              <div className="border-b border-[#E7E4DC] px-5 py-4">
                <h2 className="font-serif text-base font-semibold text-slate-900">
                  Riwayat Pengembalian Terbaru
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">No. Kembali</th>
                      <th className="px-4 py-2.5">Buku & Eksemplar</th>
                      <th className="px-4 py-2.5">Anggota</th>
                      <th className="px-4 py-2.5">Kondisi</th>
                      <th className="px-4 py-2.5 text-right">Denda</th>
                      <th className="px-4 py-2.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {returns.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-900">
                          {r.return_number}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-slate-900">{r.book_title}</p>
                          <p className="font-mono text-xs text-slate-500">{r.inventory_code}</p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{r.member_name}</td>
                        <td className="px-4 py-2.5">
                          <StatusIndicator status={r.condition} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {formatCurrencyIDR(r.fine_amount)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <StatusIndicator status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Return Inspection Modal */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Konfirmasi Pengembalian & Pemeriksaan Fisik"
        description={selected ? `${selected.book_title} (${selected.inventory_code})` : ''}
        maxWidth="max-w-lg"
      >
        {selected && (
          <form onSubmit={handleConfirmReturn} className="space-y-4">
            <div className="rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-4 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Anggota</span>
                <span className="font-medium text-slate-900">{selected.member_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Jatuh Tempo</span>
                <span className="font-mono text-slate-900">{selected.due_date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Keterlambatan (setelah masa tenggang)</span>
                <span className="font-mono font-semibold text-red-700 tabular-nums">
                  {previewOverdue} hari
                </span>
              </div>
            </div>

            <SelectField
              label="Kondisi Fisik Buku Saat Dikembalikan"
              value={condition}
              onChange={(e) => setCondition(e.target.value as CopyCondition)}
            >
              <option value="Baik">Baik (Sesuai Standar)</option>
              <option value="Rusak Ringan">Rusak Ringan (Denda Perbaikan)</option>
              <option value="Rusak Berat">Rusak Berat (Masuk Perbaikan)</option>
              <option value="Hilang">Hilang (Penggantian Nilai Buku)</option>
            </SelectField>

            <div className="rounded-lg border border-[#E7E4DC] p-4 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-600">Denda Keterlambatan</span>
                <span className="font-mono tabular-nums">
                  {formatCurrencyIDR(previewFine.lateFine)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Biaya Kerusakan / Kehilangan</span>
                <span className="font-mono tabular-nums">
                  {formatCurrencyIDR(previewFine.damageFine)}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#E7E4DC] pt-2 text-sm font-semibold text-slate-900">
                <span>Total Tagihan Denda</span>
                <span className="font-mono tabular-nums">
                  {formatCurrencyIDR(previewFine.totalFine)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ret-notes" className="text-xs font-medium text-slate-700">
                Catatan Petugas
              </label>
              <input
                id="ret-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Catatan kondisi atau penanganan"
                className="h-10 rounded-lg border border-[#E7E4DC] px-3 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
              <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
                Batal
              </Button>
              <Button type="submit" loading={processing}>
                Konfirmasi Pengembalian
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </AppShell>
  );
}
