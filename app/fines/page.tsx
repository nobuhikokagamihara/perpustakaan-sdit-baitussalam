'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Printer, Receipt, ShieldOff } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  SelectField,
  StatCard,
  StatusIndicator,
  TextField,
} from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { formatCurrencyIDR } from '@/lib/domain/library-rules';

interface FineRow {
  id: number;
  fine_number: string;
  member_code: string;
  member_name: string;
  loan_number: string | null;
  fine_type: string;
  amount: number;
  paid_amount: number;
  waived_amount: number;
  status: string;
  reason: string;
  created_at: string;
}

interface PaymentRow {
  id: number;
  payment_number: string;
  fine_number: string;
  member_code: string;
  member_name: string;
  amount: number;
  method: string;
  received_by_name: string;
  paid_at: string;
  notes: string;
}

export default function FinesPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadFines = can('fines.read');
  const canPay = can('fines.pay');
  const canWaive = can('fines.waive');

  const [fines, setFines] = useState<FineRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<FineRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Tunai');
  const [payNotes, setPayNotes] = useState('');
  const [waiveTarget, setWaiveTarget] = useState<FineRow | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [receipt, setReceipt] = useState<PaymentRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/fines', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data denda.');
      setFines(data.fines || []);
      setPayments(data.payments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data denda.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !canReadFines) return;
    let active = true;
    gatewayFetch('/api/fines', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data denda.');
        if (active) {
          setFines(data.fines || []);
          setPayments(data.payments || []);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat data denda.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadFines]);

  const totalOutstanding = fines.reduce(
    (s, f) => s + Math.max(0, f.amount - f.paid_amount - f.waived_amount),
    0
  );
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    setSubmitting(true);
    try {
      const res = await gatewayFetch('/api/fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pay',
          fineId: payTarget.id,
          amount: Number(payAmount),
          method: payMethod,
          notes: payNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pembayaran ditolak.');
      showToast('success', `Pembayaran ${data.paymentNumber}`, `Status tagihan: ${data.newStatus}`);
      setPayTarget(null);
      loadData();
    } catch (err) {
      showToast('error', 'Pembayaran gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWaive(e: React.FormEvent) {
    e.preventDefault();
    if (!waiveTarget) return;
    setSubmitting(true);
    try {
      const res = await gatewayFetch('/api/fines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'waive',
          fineId: waiveTarget.id,
          reason: waiveReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membebaskan denda.');
      showToast('success', 'Denda dibebaskan', `${waiveTarget.fine_number} dicatat di audit log.`);
      setWaiveTarget(null);
      setWaiveReason('');
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell
      title="Denda & Pembayaran"
      description="Kelola tagihan keterlambatan, kerusakan, kehilangan, pembayaran parsial/penuh, pengecualian resmi, dan bukti bayar."
      requiredPermission="fines.read"
    >
      {loading && <LoadingState rows={5} />}
      {error && <ErrorState message={error} onRetry={loadData} />}

      {!loading && !error && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Tunggakan Aktif"
              value={formatCurrencyIDR(totalOutstanding)}
              tone={totalOutstanding > 0 ? 'danger' : 'success'}
            />
            <StatCard
              label="Total Pembayaran Diterima"
              value={formatCurrencyIDR(totalCollected)}
              tone="success"
            />
            <StatCard label="Total Catatan Denda" value={fines.length} />
          </div>

          <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
            <div className="border-b border-[#E7E4DC] px-5 py-4">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                Daftar Tagihan Denda
              </h2>
            </div>
            {fines.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Tidak ada tagihan denda"
                  description="Tagihan keterlambatan, kerusakan, atau kehilangan akan tampil di sini."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">No. Denda</th>
                      <th className="px-4 py-3">Anggota</th>
                      <th className="px-4 py-3">Jenis & Keterangan</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Sisa Tagihan</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {fines.map((f) => {
                      const remaining = Math.max(0, f.amount - f.paid_amount - f.waived_amount);
                      return (
                        <tr key={f.id} className="hover:bg-[#F4F3EE]/80">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                            {f.fine_number}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{f.member_name}</p>
                            <p className="font-mono text-xs text-slate-500">{f.member_code}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-semibold text-slate-800">{f.fine_type}</p>
                            <p className="text-xs text-slate-500">{f.reason}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            {formatCurrencyIDR(f.amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-red-700 tabular-nums">
                            {formatCurrencyIDR(remaining)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusIndicator status={f.status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {remaining > 0 && (
                              <div className="flex justify-end gap-1.5">
                                {canPay && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setPayTarget(f);
                                      setPayAmount(String(remaining));
                                      setPayNotes('');
                                    }}
                                  >
                                    <Receipt className="h-3.5 w-3.5" />
                                    Bayar
                                  </Button>
                                )}
                                {canWaive && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setWaiveTarget(f)}
                                  >
                                    <ShieldOff className="h-3.5 w-3.5" />
                                    Bebaskan
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
          </section>

          {/* Payment History */}
          <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
            <div className="border-b border-[#E7E4DC] px-5 py-4">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                Riwayat Pembayaran & Bukti Bayar
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">No. Pembayaran</th>
                    <th className="px-4 py-2.5">No. Denda</th>
                    <th className="px-4 py-2.5">Anggota</th>
                    <th className="px-4 py-2.5">Metode</th>
                    <th className="px-4 py-2.5 text-right">Nominal</th>
                    <th className="px-4 py-2.5 text-right">Bukti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-900">
                        {p.payment_number}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {p.fine_number}
                      </td>
                      <td className="px-4 py-2.5 text-slate-900">{p.member_name}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{p.method}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {formatCurrencyIDR(p.amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button variant="secondary" size="sm" onClick={() => setReceipt(p)}>
                          <Printer className="h-3.5 w-3.5" />
                          Cetak Bukti
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* Pay Fine Modal */}
      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={`Proses Pembayaran · ${payTarget?.fine_number}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handlePay} className="space-y-4">
          <TextField
            label="Nominal Pembayaran (Rp)"
            type="number"
            min={1}
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value)}
            required
          />
          <SelectField
            label="Metode Pembayaran"
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value)}
          >
            <option value="Tunai">Tunai</option>
            <option value="QRIS">QRIS</option>
            <option value="Transfer">Transfer Bank</option>
          </SelectField>
          <TextField
            label="Catatan"
            value={payNotes}
            onChange={(e) => setPayNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setPayTarget(null)}>
              Batal
            </Button>
            <Button type="submit" loading={submitting}>
              Konfirmasi Pembayaran
            </Button>
          </div>
        </form>
      </Modal>

      {/* Waive Fine Modal */}
      <Modal
        open={Boolean(waiveTarget)}
        onClose={() => setWaiveTarget(null)}
        title={`Pengecualian Denda · ${waiveTarget?.fine_number}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleWaive} className="space-y-4">
          <TextField
            label="Alasan Pengecualian Resmi *"
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setWaiveTarget(null)}>
              Batal
            </Button>
            <Button type="submit" variant="danger" loading={submitting}>
              Bebaskan Denda
            </Button>
          </div>
        </form>
      </Modal>

      {/* Printable Receipt Modal */}
      <Modal
        open={Boolean(receipt)}
        onClose={() => setReceipt(null)}
        title="Bukti Pembayaran Denda Perpustakaan"
        maxWidth="max-w-md"
      >
        {receipt && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#DFDCD4] bg-[#FAF9F5] p-5 text-xs space-y-2">
              <p className="font-serif text-sm font-bold text-slate-900">
                PERPUSTAKAAN LENTERA PUSTAKA
              </p>
              <p className="text-slate-500">Kwitansi Pembayaran Resmi</p>
              <div className="border-t border-dashed border-[#DFDCD4] pt-2 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">No. Pembayaran</span>
                  <span className="font-mono font-semibold">{receipt.payment_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">No. Denda</span>
                  <span className="font-mono">{receipt.fine_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Anggota</span>
                  <span>
                    {receipt.member_name} ({receipt.member_code})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Metode / Tanggal</span>
                  <span className="font-mono">
                    {receipt.method} · {receipt.paid_at.slice(0, 10)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[#E7E4DC] pt-2 text-sm font-bold text-slate-900">
                  <span>Total Dibayar</span>
                  <span className="font-mono">{formatCurrencyIDR(receipt.amount)}</span>
                </div>
              </div>
              <p className="pt-2 text-[11px] text-slate-500">
                Petugas penerima: {receipt.received_by_name || 'Sistem'}
              </p>
            </div>
            <div className="no-print flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReceipt(null)}>
                Tutup
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Cetak Bukti
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
