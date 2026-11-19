'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, QrCode, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE_EDITORIAL, MOTION_DURATION } from '@/lib/motion/presets';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchField,
  StatusIndicator,
} from '@/components/ui/DesignPrimitives';
import { QrCheckoutScannerModal } from '@/components/loans/QrCheckoutScannerModal';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { gatewayFetch } from '@/lib/client/data-gateway';
import { formatCurrencyIDR, formatIsoDate } from '@/lib/domain/library-rules';
import { parseQrPayload, resolveQrCheckoutScan } from '@/lib/domain/qr-checkout';

interface MemberOption {
  id: number;
  member_code: string;
  full_name: string;
  status: string;
  expires_at?: string;
  membership_type_name: string;
  active_loans_count: number;
  max_loans: number;
  loan_duration_days: number;
  unpaid_fines_total: number;
}

interface CopyOption {
  id: number;
  inventory_code: string;
  barcode: string;
  status: string;
  book_title: string;
  is_reference_only: number;
  read_in_place_only: number;
}

interface LoanRow {
  id: number;
  loan_number: string;
  member_code: string;
  member_name: string;
  loan_date: string;
  due_date: string;
  status: string;
  max_renewals: number;
  items: Array<{
    id: number;
    copy_id: number;
    inventory_code: string;
    book_title: string;
    due_date: string;
    returned_at: string | null;
    status: string;
    renewal_count: number;
  }>;
}

interface OfflineLoanDraft {
  idempotencyKey: string;
  memberId: number;
  memberName: string;
  copyIds: number[];
  createdAt: string;
}

const OFFLINE_QUEUE_KEY = 'lentera_offline_loans_v1';

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `loan-${crypto.randomUUID()}`;
  }
  return `loan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function LoansPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadLoans = can('loans.read');
  const isStaff = can('loans.write');

  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [allCopies, setAllCopies] = useState<CopyOption[]>([]);
  const [loanPolicy, setLoanPolicy] = useState<{
    blockOnUnpaidFinesLimit: number;
    allowOverdueRenewal: boolean;
  }>({ blockOnUnpaidFinesLimit: 25000, allowOverdueRenewal: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Checkout desk state
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [basket, setBasket] = useState<CopyOption[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);

  // Offline queue state
  const [offlineQueue, setOfflineQueue] = useState<OfflineLoanDraft[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (saved) setOfflineQueue(JSON.parse(saved));
      } catch {
        // ignore storage errors
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (statusFilter) sp.set('status', statusFilter);

      const loanRes = await gatewayFetch(`/api/loans?${sp.toString()}`, { cache: 'no-store' });
      const loanData = await loanRes.json();
      if (!loanRes.ok) throw new Error(loanData.error || 'Gagal memuat transaksi peminjaman.');
      setLoans(loanData.loans || []);
      if (loanData.policy) {
        setLoanPolicy({
          blockOnUnpaidFinesLimit: Number(loanData.policy.blockOnUnpaidFinesLimit ?? 25000),
          allowOverdueRenewal: Boolean(loanData.policy.allowOverdueRenewal),
        });
      }

      if (isStaff) {
        const [memRes, invRes] = await Promise.all([
          gatewayFetch('/api/members', { cache: 'no-store' }),
          gatewayFetch('/api/inventory', { cache: 'no-store' }),
        ]);
        if (memRes.ok) {
          const md = await memRes.json();
          setMembers(md.members || []);
        }
        if (invRes.ok) {
          const idata = await invRes.json();
          setAllCopies((idata.copies || []) as CopyOption[]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat peminjaman.');
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, isStaff]);

  useEffect(() => {
    if (authLoading || !user || !canReadLoans) return;
    let active = true;
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (statusFilter) sp.set('status', statusFilter);

    gatewayFetch(`/api/loans?${sp.toString()}`, { cache: 'no-store' })
      .then(async (loanRes) => {
        const loanData = await loanRes.json();
        if (!loanRes.ok) throw new Error(loanData.error || 'Gagal memuat transaksi peminjaman.');
        if (active) {
          setLoans(loanData.loans || []);
          if (loanData.policy) {
            setLoanPolicy({
              blockOnUnpaidFinesLimit: Number(loanData.policy.blockOnUnpaidFinesLimit ?? 25000),
              allowOverdueRenewal: Boolean(loanData.policy.allowOverdueRenewal),
            });
          }
          setError(null);
        }
        if (isStaff) {
          const [memRes, invRes] = await Promise.all([
            gatewayFetch('/api/members', { cache: 'no-store' }),
            gatewayFetch('/api/inventory', { cache: 'no-store' }),
          ]);
          if (active && memRes.ok) {
            const md = await memRes.json();
            setMembers(md.members || []);
          }
          if (active && invRes.ok) {
            const idata = await invRes.json();
            setAllCopies((idata.copies || []) as CopyOption[]);
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat peminjaman.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user, canReadLoans, q, statusFilter, isStaff]);

  const availableCopies = allCopies.filter((c) => c.status === 'Tersedia');
  const selectedMember = members.find((m) => m.id === selectedMemberId) || null;
  const parsedMemberQuery = parseQrPayload(memberSearch).normalizedCode.toLowerCase();
  const filteredMembers = members
    .filter(
      (m) =>
        !memberSearch ||
        m.member_code.toLowerCase().includes(memberSearch.toLowerCase()) ||
        m.full_name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        (parsedMemberQuery && m.member_code.toLowerCase() === parsedMemberQuery)
    )
    .sort((a, b) => {
      if (a.status === 'Aktif' && b.status !== 'Aktif') return -1;
      if (a.status !== 'Aktif' && b.status === 'Aktif') return 1;
      return 0;
    });

  function addCopyToBasket(copy: CopyOption) {
    if (basket.some((b) => b.id === copy.id)) {
      showToast('info', 'Sudah di keranjang', `${copy.inventory_code} sudah ditambahkan.`);
      return;
    }
    setBasket((prev) => [...prev, copy]);
    setBarcodeInput('');
  }

  function handleBarcodeAdd(e: React.FormEvent) {
    e.preventDefault();
    const raw = barcodeInput.trim();
    if (!raw) return;

    const qrRes = resolveQrCheckoutScan({
      rawText: raw,
      members,
      copies: allCopies,
      basketCopyIds: basket.map((b) => b.id),
      selectedMember,
      todayStr: formatIsoDate(new Date()),
      scanMode: 'auto',
    });

    if (qrRes.ok && qrRes.kind === 'copy') {
      addCopyToBasket(qrRes.copy);
      return;
    }
    if (qrRes.ok && qrRes.kind === 'member') {
      setSelectedMemberId(qrRes.member.id);
      setBarcodeInput('');
      showToast('success', 'Anggota dipilih via QR', `${qrRes.member.full_name} (${qrRes.member.member_code})`);
      return;
    }
    if (!qrRes.ok && qrRes.status !== 'not_found') {
      showToast('error', 'Eksemplar tidak dapat dipinjam', qrRes.reason);
      return;
    }

    const term = parseQrPayload(raw).normalizedCode.toLowerCase();
    const match = availableCopies.find(
      (c) =>
        c.barcode.toLowerCase() === term ||
        c.inventory_code.toLowerCase() === term ||
        c.book_title.toLowerCase().includes(term)
    );
    if (!match) {
      showToast('error', 'Eksemplar tidak ditemukan / sedang dipinjam', barcodeInput);
      return;
    }
    addCopyToBasket(match);
  }

  async function handleCheckout(): Promise<boolean> {
    if (!selectedMember) {
      showToast('error', 'Pilih anggota', 'Tentukan anggota peminjam terlebih dahulu.');
      return false;
    }
    if (basket.length === 0) {
      showToast('error', 'Keranjang kosong', 'Tambahkan minimal satu eksemplar buku.');
      return false;
    }

    const idempotencyKey = createIdempotencyKey();
    const payload = {
      memberId: selectedMember.id,
      copyIds: basket.map((b) => b.id),
      notes,
      idempotencyKey,
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const updated = [
        ...offlineQueue,
        {
          idempotencyKey,
          memberId: selectedMember.id,
          memberName: selectedMember.full_name,
          copyIds: payload.copyIds,
          createdAt: new Date().toISOString(),
        },
      ];
      setOfflineQueue(updated);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(updated));
      setBasket([]);
      showToast('info', 'Disimpan ke antrean offline', 'Transaksi akan disinkronkan saat koneksi kembali.');
      return true;
    }

    setSubmitting(true);
    try {
      const res = await gatewayFetch('/api/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan transaksi.');
      showToast(
        'success',
        'Peminjaman berhasil',
        `Nomor ${data.loanNumber} · Jatuh tempo ${data.dueDate}`
      );
      setBasket([]);
      setNotes('');
      setSelectedMemberId(null);
      loadData();
      return true;
    } catch (err) {
      showToast('error', 'Transaksi ditolak', err instanceof Error ? err.message : 'Error');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function syncOfflineQueue() {
    const remaining: OfflineLoanDraft[] = [];
    for (const draft of offlineQueue) {
      try {
        const res = await gatewayFetch('/api/loans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memberId: draft.memberId,
            copyIds: draft.copyIds,
            idempotencyKey: draft.idempotencyKey,
            notes: 'Sinkronisasi transaksi offline',
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          showToast('error', `Konflik sinkronisasi (${draft.memberName})`, d.error);
          remaining.push(draft);
        } else {
          showToast('success', 'Tersinkronisasi', `Transaksi ${draft.memberName} berhasil disimpan.`);
        }
      } catch {
        remaining.push(draft);
      }
    }
    setOfflineQueue(remaining);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    loadData();
  }

  async function handleRenew(loanId: number, loanItemId: number) {
    try {
      const res = await gatewayFetch(`/api/loans/${loanId}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanItemId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memperpanjang peminjaman.');
      showToast('success', 'Perpanjangan berhasil', `Jatuh tempo baru: ${data.newDueDate}`);
      loadData();
    } catch (err) {
      showToast('error', 'Perpanjangan ditolak', err instanceof Error ? err.message : 'Error');
    }
  }

  return (
    <AppShell
      title="Peminjaman & Perpanjangan Buku"
      description="Meja sirkulasi cepat dengan validasi batas pinjaman, status blokir, ketersediaan eksemplar, dan perpanjangan."
      requiredPermission="loans.read"
      actions={
        <>
          {isStaff && (
            <Button onClick={() => setQrScannerOpen(true)}>
              <QrCode className="h-4 w-4" />
              Pindai QR Checkout
            </Button>
          )}
          {offlineQueue.length > 0 && (
            <Button variant="secondary" onClick={syncOfflineQueue}>
              <WifiOff className="h-4 w-4 text-amber-700" />
              Sinkronkan Antrean ({offlineQueue.length})
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {/* Staff Circulation Checkout Desk */}
        {isStaff && (
          <section className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-6 space-y-5">
            <div className="border-b border-[#EAE7DF] pb-4">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                Meja Sirkulasi Peminjaman
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Pilih anggota dan eksemplar secara manual atau klik Pindai QR Checkout di kanan atas untuk pemindaian beruntun.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Step 1: Member */}
              <div className="space-y-3">
                <h3 className="font-serif text-sm font-semibold text-slate-900">
                  1. Pilih atau Pindai Anggota
                </h3>
                <SearchField
                  value={memberSearch}
                  onChange={setMemberSearch}
                  placeholder="Ketik nomor anggota (AGT-...) atau nama..."
                  ariaLabel="Cari anggota peminjam"
                />
                <div className="max-h-44 overflow-y-auto rounded-lg border border-[#E7E4DC] divide-y divide-[#EAE7DF]">
                  {filteredMembers.slice(0, 8).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMemberId(m.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                        selectedMemberId === m.id ? 'bg-[#EFECE3]' : 'hover:bg-[#F4F3EE]/80'
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-slate-900">{m.full_name}</p>
                        <p className="font-mono text-slate-500">
                          {m.member_code} · {m.membership_type_name}
                        </p>
                      </div>
                      <StatusIndicator status={m.status} />
                    </button>
                  ))}
                </div>

                <AnimatePresence initial={false}>
                  {selectedMember && (
                    <motion.div
                      key={selectedMember.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                      className="rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{selectedMember.full_name}</span>
                        <StatusIndicator status={selectedMember.status} />
                      </div>
                      <p className="mt-1 text-slate-600 tabular-nums">
                        Pinjaman aktif: <strong>{selectedMember.active_loans_count}</strong> /{' '}
                        {selectedMember.max_loans} buku · Durasi: {selectedMember.loan_duration_days}{' '}
                        hari · Denda belum lunas:{' '}
                        <strong>{formatCurrencyIDR(selectedMember.unpaid_fines_total)}</strong>
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Step 2: Books & Confirm */}
              <div className="space-y-3">
                <h3 className="font-serif text-sm font-semibold text-slate-900">
                  2. Pindai QR / Barcode & Tambah Eksemplar
                </h3>
              <form onSubmit={handleBarcodeAdd} className="flex gap-2">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan barcode, kode inventaris (LP-2026-...), atau judul..."
                  aria-label="Barcode atau kode inventaris buku"
                  className="h-10 flex-1 rounded-lg border border-[#E7E4DC] px-3 text-sm"
                />
                <Button type="submit" variant="secondary">
                  <Plus className="h-4 w-4" />
                  Tambah
                </Button>
              </form>

              <select
                aria-label="Pilih eksemplar tersedia dari daftar"
                value=""
                onChange={(e) => {
                  const found = availableCopies.find((c) => c.id === Number(e.target.value));
                  if (found) addCopyToBasket(found);
                }}
                className="h-10 w-full rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-xs text-slate-700"
              >
                <option value="">
                  -- Atau pilih langsung eksemplar dapat dipinjam (
                  {availableCopies.filter((c) => !c.is_reference_only && !c.read_in_place_only).length}
                  ) --
                </option>
                {availableCopies
                  .filter((c) => !c.is_reference_only && !c.read_in_place_only)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      [{c.inventory_code}] {c.book_title}
                    </option>
                  ))}
              </select>

              <div className="min-h-[88px] rounded-lg border border-[#E7E4DC] p-2">
                {basket.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    Belum ada eksemplar di keranjang peminjaman.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#EAE7DF]">
                    <AnimatePresence initial={false}>
                      {basket.map((item) => (
                        <motion.li
                          key={item.id}
                          layout
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 8 }}
                          transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{item.book_title}</p>
                            <p className="font-mono text-slate-500">
                              {item.inventory_code} · {item.barcode}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setBasket((prev) => prev.filter((x) => x.id !== item.id))}
                            aria-label={`Hapus ${item.inventory_code}`}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Catatan transaksi (opsional)"
                  aria-label="Catatan transaksi"
                  className="h-10 flex-1 rounded-lg border border-[#E7E4DC] px-3 text-xs"
                />
                <Button
                  loading={submitting}
                  disabled={!selectedMember || basket.length === 0}
                  onClick={() => void handleCheckout()}
                >
                  Konfirmasi Peminjaman
                </Button>
              </div>
            </div>
            </div>
          </section>
        )}

        {/* Loans History & Active Renewals */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] p-4">
            <SearchField
              value={q}
              onChange={setQ}
              placeholder="Cari nomor peminjaman, anggota, atau judul buku..."
              ariaLabel="Cari daftar peminjaman"
              className="w-full sm:w-80"
            />
            <select
              aria-label="Filter status peminjaman"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] px-3 text-sm"
            >
              <option value="">Semua Status</option>
              <option value="Aktif">Aktif</option>
              <option value="Terlambat">Terlambat</option>
              <option value="Sebagian Kembali">Sebagian Kembali</option>
              <option value="Selesai">Selesai</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E7E4DC] bg-[#F4F3EE]/80 px-4 py-2 text-xs text-[#5C5E64]">
            <span>
              Batas tunggakan blokir pinjam:{' '}
              <strong className="font-mono text-[#1E2433] tabular-nums">
                {formatCurrencyIDR(loanPolicy.blockOnUnpaidFinesLimit)}
              </strong>
            </span>
            <span>
              Perpanjangan saat terlambat:{' '}
              <strong className="text-[#1E2433]">
                {loanPolicy.allowOverdueRenewal ? 'Diizinkan' : 'Tidak Diizinkan'}
              </strong>
            </span>
          </div>

          {loading && <LoadingState rows={5} />}
          {error && <ErrorState message={error} onRetry={loadData} />}

          {!loading && !error && loans.length === 0 && (
            <EmptyState
              title="Belum ada transaksi peminjaman"
              description="Transaksi peminjaman yang diproses akan tercatat di sini."
            />
          )}

          {!loading && !error && loans.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[#E7E4DC] bg-[#FAF9F5]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">No. Transaksi</th>
                      <th className="px-4 py-3">Anggota</th>
                      <th className="px-4 py-3">Daftar Buku & Perpanjangan</th>
                      <th className="px-4 py-3">Tanggal Pinjam</th>
                      <th className="px-4 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAE7DF]">
                    {loans.map((loan) => (
                      <tr key={loan.id} className="align-top hover:bg-[#F4F3EE]/80">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                          {loan.loan_number}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{loan.member_name}</p>
                          <p className="font-mono text-xs text-slate-500">{loan.member_code}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1.5">
                            {loan.items.map((it) => (
                              <div
                                key={it.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div>
                                  <span className="font-medium text-slate-800">{it.book_title}</span>
                                  <span className="ml-1.5 font-mono text-slate-500">
                                    ({it.inventory_code}) · Tempo {it.due_date}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <StatusIndicator status={it.status} />
                                  {!it.returned_at && (() => {
                                    const isOverdueItem = it.status === 'Terlambat' || it.due_date < formatIsoDate(new Date());
                                    const blockedByOverduePolicy = isOverdueItem && !loanPolicy.allowOverdueRenewal;
                                    return (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={blockedByOverduePolicy}
                                        title={
                                          blockedByOverduePolicy
                                            ? 'Perpanjangan saat terlambat dinonaktifkan di Pengaturan Sistem'
                                            : undefined
                                        }
                                        onClick={() => handleRenew(loan.id, it.id)}
                                      >
                                        <RefreshCw className="h-3 w-3" />
                                        Perpanjang ({it.renewal_count}/{loan.max_renewals})
                                      </Button>
                                    );
                                  })()}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                          {loan.loan_date}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <StatusIndicator status={loan.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {isStaff && (
        <QrCheckoutScannerModal
          open={qrScannerOpen}
          onClose={() => setQrScannerOpen(false)}
          members={members}
          allCopies={allCopies}
          selectedMember={selectedMember}
          basket={basket}
          notes={notes}
          submitting={submitting}
          onSelectMember={setSelectedMemberId}
          onAddCopy={addCopyToBasket}
          onRemoveCopy={(id) => setBasket((prev) => prev.filter((x) => x.id !== id))}
          onChangeNotes={setNotes}
          onConfirmCheckout={handleCheckout}
        />
      )}
    </AppShell>
  );
}
