'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, PackageCheck, Plus, X } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Button,
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
import { formatCurrencyIDR } from '@/lib/domain/library-rules';

interface AcquisitionRow {
  id: number;
  request_number: string;
  title_summary: string;
  supplier_name: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  total_estimated_cost: number;
  status: string;
  created_at: string;
  items: Array<{
    id: number;
    title: string;
    author_name: string;
    quantity_ordered: number;
    quantity_received: number;
    unit_price: number;
  }>;
}

export default function AcquisitionsPage() {
  const { user, loading: authLoading, can } = useAuth();
  const { showToast } = useToast();
  const canReadAcq = can('acquisitions.read');
  const canApprove = can('acquisitions.approve');

  const [acquisitions, setAcquisitions] = useState<AcquisitionRow[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: number; code: string; name: string; contact_person: string; phone: string }>>([]);
  const [shelves, setShelves] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reqOpen, setReqOpen] = useState(false);
  const [supOpen, setSupOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<AcquisitionRow | null>(null);
  const [receiveShelfId, setReceiveShelfId] = useState('');

  // Request form
  const [titleSummary, setTitleSummary] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [itemTitle, setItemTitle] = useState('');
  const [itemIsbn, setItemIsbn] = useState('');
  const [itemAuthor, setItemAuthor] = useState('');
  const [itemQty, setItemQty] = useState('3');
  const [itemPrice, setItemPrice] = useState('65000');

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch('/api/acquisitions', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memuat data pengadaan.');
      setAcquisitions(data.acquisitions || []);
      setSuppliers(data.suppliers || []);
      setShelves(data.shelves || []);
      if (data.suppliers?.length && !supplierId) setSupplierId(String(data.suppliers[0].id));
      if (data.shelves?.length && !receiveShelfId) setReceiveShelfId(String(data.shelves[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengadaan.');
    } finally {
      setLoading(false);
    }
  }, [supplierId, receiveShelfId]);

  useEffect(() => {
    if (authLoading || !user || !canReadAcq) return;
    let active = true;
    gatewayFetch('/api/acquisitions', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal memuat data pengadaan.');
        if (active) {
          setAcquisitions(data.acquisitions || []);
          setSuppliers(data.suppliers || []);
          setShelves(data.shelves || []);
          if (data.suppliers?.length) {
            setSupplierId((prev) => prev || String(data.suppliers[0].id));
          }
          if (data.shelves?.length) {
            setReceiveShelfId((prev) => prev || String(data.shelves[0].id));
          }
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat pengadaan.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, user, canReadAcq]);

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    const res = await gatewayFetch('/api/acquisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_request',
        titleSummary,
        supplierId: supplierId ? Number(supplierId) : null,
        items: [
          {
            title: itemTitle,
            isbn: itemIsbn,
            authorName: itemAuthor,
            quantity: Number(itemQty),
            unitPrice: Number(itemPrice),
          },
        ],
      }),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast('error', 'Gagal', d.error);
      return;
    }
    showToast('success', 'Usulan pengadaan dibuat', d.requestNumber);
    setReqOpen(false);
    setTitleSummary('');
    setItemTitle('');
    loadData();
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await gatewayFetch('/api/acquisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_supplier',
          name: supName,
          contactPerson: supContact,
          phone: supPhone,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', 'Gagal menambahkan pemasok', d.error || 'Terjadi kesalahan.');
        return;
      }
      showToast('success', 'Pemasok ditambahkan', supName);
      setSupOpen(false);
      setSupName('');
      setSupContact('');
      setSupPhone('');
      loadData();
    } catch (err) {
      showToast('error', 'Gagal', err instanceof Error ? err.message : 'Kesalahan jaringan.');
    }
  }

  async function handleWorkflow(acquisitionId: number, action: string, extra?: Record<string, unknown>) {
    const res = await gatewayFetch('/api/acquisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, acquisitionId, ...extra }),
    });
    const d = await res.json();
    if (!res.ok) {
      showToast('error', 'Aksi ditolak', d.error);
      return;
    }
    showToast('success', 'Status pengadaan diperbarui', action);
    setReceiveTarget(null);
    loadData();
  }

  return (
    <AppShell
      title="Pengadaan Buku & Pemasok"
      description="Kelola usulan pengadaan, persetujuan Kepala Perpustakaan, pemesanan ke pemasok, hingga pencatatan ke inventaris."
      requiredPermission="acquisitions.read"
      actions={
        <>
          <Button variant="secondary" onClick={() => setSupOpen(true)}>
            <Plus className="h-4 w-4" />
            Tambah Pemasok
          </Button>
          <Button onClick={() => setReqOpen(true)}>
            <Plus className="h-4 w-4" />
            Usulan Pengadaan
          </Button>
        </>
      }
    >
      {loading && <LoadingState rows={5} />}
      {error && <ErrorState message={error} onRetry={loadData} />}

      {!loading && !error && (
        <div className="space-y-6">
          <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] overflow-hidden">
            <div className="border-b border-[#E7E4DC] px-5 py-4">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                Daftar Pengadaan Koleksi
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#E7E4DC] bg-[#F4F3EE] text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">No. Pengadaan</th>
                    <th className="px-4 py-3">Ringkasan & Item</th>
                    <th className="px-4 py-3">Pemasok</th>
                    <th className="px-4 py-3 text-right">Estimasi Biaya</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE7DF]">
                  {acquisitions.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-[#F4F3EE]/80">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                        {a.request_number}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{a.title_summary}</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                          {a.items.map((it) => (
                            <li key={it.id}>
                              • {it.title} ({it.quantity_received}/{it.quantity_ordered} eks)
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{a.supplier_name || '-'}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                        {formatCurrencyIDR(a.total_estimated_cost)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusIndicator status={a.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          {(a.status === 'Menunggu Persetujuan' || a.status === 'Diajukan') &&
                            canApprove && (
                              <>
                                <Button size="sm" onClick={() => handleWorkflow(a.id, 'approve')}>
                                  <Check className="h-3.5 w-3.5" />
                                  Setujui
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => handleWorkflow(a.id, 'reject')}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Tolak
                                </Button>
                              </>
                            )}
                          {a.status === 'Disetujui' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleWorkflow(a.id, 'mark_ordered')}
                            >
                              Tandai Dipesan
                            </Button>
                          )}
                          {(a.status === 'Dipesan' || a.status === 'Disetujui') && (
                            <Button size="sm" onClick={() => setReceiveTarget(a)}>
                              <PackageCheck className="h-3.5 w-3.5" />
                              Terima ke Inventaris
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] overflow-hidden">
            <div className="border-b border-[#E7E4DC] px-5 py-4">
              <h2 className="font-serif text-base font-semibold text-slate-900">
                Daftar Pemasok ({suppliers.length})
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {suppliers.map((s) => (
                <div key={s.id} className="rounded-lg border border-[#E7E4DC] p-4 text-xs">
                  <p className="font-mono text-[#E56B63] font-semibold">{s.code}</p>
                  <p className="mt-1 font-serif text-sm font-semibold text-slate-900">{s.name}</p>
                  <p className="mt-1 text-slate-600">
                    Kontak: {s.contact_person || '-'} · {s.phone || '-'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* New Acquisition Request Modal */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="Buat Usulan Pengadaan Buku">
        <form onSubmit={handleCreateRequest} className="space-y-4">
          <TextField label="Ringkasan Pengadaan *" value={titleSummary} onChange={(e) => setTitleSummary(e.target.value)} placeholder="Contoh: Pengadaan Buku Cerita & Sains Kelas 1–6" required />
          <SelectField label="Pemasok" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </SelectField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Judul Buku *" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} required />
            <TextField label="ISBN" value={itemIsbn} onChange={(e) => setItemIsbn(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField label="Penulis" value={itemAuthor} onChange={(e) => setItemAuthor(e.target.value)} />
            <TextField label="Jumlah Eksemplar" type="number" min={1} value={itemQty} onChange={(e) => setItemQty(e.target.value)} />
            <TextField label="Harga Satuan (Rp)" type="number" min={0} value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 border-t border-[#E7E4DC] pt-4">
            <Button type="button" variant="secondary" onClick={() => setReqOpen(false)}>Batal</Button>
            <Button type="submit">Ajukan Pengadaan</Button>
          </div>
        </form>
      </Modal>

      {/* New Supplier Modal */}
      <Modal open={supOpen} onClose={() => setSupOpen(false)} title="Tambah Pemasok Baru" maxWidth="max-w-md">
        <form onSubmit={handleCreateSupplier} className="space-y-4">
          <TextField label="Nama Pemasok *" value={supName} onChange={(e) => setSupName(e.target.value)} required />
          <TextField label="Narahubung" value={supContact} onChange={(e) => setSupContact(e.target.value)} />
          <TextField label="Telepon" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setSupOpen(false)}>Batal</Button>
            <Button type="submit">Simpan Pemasok</Button>
          </div>
        </form>
      </Modal>

      {/* Receive into Inventory Modal */}
      <Modal open={Boolean(receiveTarget)} onClose={() => setReceiveTarget(null)} title={`Terima Barang · ${receiveTarget?.request_number}`} maxWidth="max-w-md">
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Sistem akan otomatis mendaftarkan judul buku dan mencetak kode inventaris eksemplar ke rak yang dipilih.
          </p>
          <SelectField label="Rak Penempatan Awal" value={receiveShelfId} onChange={(e) => setReceiveShelfId(e.target.value)}>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReceiveTarget(null)}>Batal</Button>
            <Button onClick={() => receiveTarget && handleWorkflow(receiveTarget.id, 'receive', { shelfId: Number(receiveShelfId) })}>
              Konfirmasi Penerimaan
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
