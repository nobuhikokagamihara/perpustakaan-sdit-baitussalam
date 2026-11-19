export type CopyStatus =
  | 'Tersedia'
  | 'Dipinjam'
  | 'Direservasi'
  | 'Perbaikan'
  | 'Hilang'
  | 'Dihapus';

export type CopyCondition = 'Baik' | 'Rusak Ringan' | 'Rusak Berat' | 'Hilang';

export type MemberStatus = 'Aktif' | 'Nonaktif' | 'Diblokir';

export interface LoanEligibilityInput {
  memberStatus: MemberStatus;
  memberExpiresAt: string; // YYYY-MM-DD
  activeLoansCount: number;
  maxLoans: number;
  requestedCount: number;
  copyStatus: CopyStatus;
  isReferenceOnly: boolean;
  readInPlaceOnly: boolean;
  todayStr: string; // YYYY-MM-DD
  unpaidFinesTotal: number;
  blockOnUnpaidFinesLimit: number;
  reservedForMember?: boolean;
}

export interface EligibilityResult {
  ok: boolean;
  reason?: string;
}

export interface RenewalEligibilityInput {
  memberStatus: MemberStatus;
  memberExpiresAt: string;
  todayStr: string;
  currentRenewals: number;
  maxRenewals: number;
  dueDateStr: string;
  hasActiveReservationQueue: boolean;
  allowOverdueRenewal: boolean;
}

export interface FineCalculationInput {
  overdueDays: number;
  dailyRate: number;
  maxCap: number;
  condition: CopyCondition;
  bookPrice: number;
  damageFeePercent: number;
  lostFeePercent?: number;
}

export interface FineCalculationResult {
  lateFine: number;
  damageFine: number;
  totalFine: number;
}

export interface PaymentValidationInput {
  fineAmount: number;
  paidAmount: number;
  waivedAmount: number;
  paymentAmount: number;
  allowPartialPayment: boolean;
}

export interface PaymentValidationResult {
  ok: boolean;
  reason?: string;
  newPaidAmount?: number;
  newStatus?: 'Belum Lunas' | 'Sebagian' | 'Lunas' | 'Dibebaskan';
}

export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIsoDate(dt);
}

export function calculateDueDate(loanDateStr: string, durationDays: number): string {
  const safeDuration = Math.max(1, Math.floor(durationDays));
  return addDaysIso(loanDateStr, safeDuration);
}

export function diffDaysIso(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split('-').map(Number);
  const [ty, tm, td] = toDateStr.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

export function calculateOverdueDays(
  dueDateStr: string,
  returnDateStr: string,
  graceDays = 0
): number {
  const rawDiff = diffDaysIso(dueDateStr, returnDateStr);
  if (rawDiff <= Math.max(0, graceDays)) {
    return 0;
  }
  return rawDiff;
}

export function calculateFineAmount(input: FineCalculationInput): FineCalculationResult {
  const overdueDays = Math.max(0, Math.floor(input.overdueDays));
  const dailyRate = Math.max(0, input.dailyRate);
  const maxCap = Math.max(0, input.maxCap);
  const rawLate = overdueDays * dailyRate;
  const lateFine = maxCap > 0 ? Math.min(rawLate, maxCap) : rawLate;

  let damageFine = 0;
  const safePrice = Math.max(0, input.bookPrice);
  if (input.condition === 'Hilang') {
    const lostPct =
      input.lostFeePercent !== undefined
        ? Math.min(100, Math.max(0, input.lostFeePercent))
        : 100;
    damageFine = Math.round(safePrice * (lostPct / 100));
  } else if (input.condition === 'Rusak Berat') {
    damageFine = Math.round(safePrice * (Math.min(100, Math.max(0, input.damageFeePercent)) / 100));
  } else if (input.condition === 'Rusak Ringan') {
    damageFine = Math.round(safePrice * (Math.min(100, Math.max(0, input.damageFeePercent)) / 200));
  }

  return {
    lateFine,
    damageFine,
    totalFine: lateFine + damageFine,
  };
}

export function validateLoanEligibility(input: LoanEligibilityInput): EligibilityResult {
  if (input.memberStatus === 'Diblokir') {
    return { ok: false, reason: 'Anggota sedang diblokir sementara dan tidak dapat meminjam buku.' };
  }
  if (input.memberStatus !== 'Aktif') {
    return { ok: false, reason: 'Status keanggotaan tidak aktif.' };
  }
  if (input.memberExpiresAt < input.todayStr) {
    return { ok: false, reason: 'Masa berlaku keanggotaan telah habis. Harap perpanjang terlebih dahulu.' };
  }
  if (
    input.blockOnUnpaidFinesLimit > 0 &&
    input.unpaidFinesTotal >= input.blockOnUnpaidFinesLimit
  ) {
    return {
      ok: false,
      reason: `Tunggakan denda anggota mencapai batas maksimal (${formatCurrencyIDR(input.unpaidFinesTotal)}).`,
    };
  }
  if (input.requestedCount < 1) {
    return { ok: false, reason: 'Minimal 1 eksemplar buku harus dipilih.' };
  }
  if (input.activeLoansCount + input.requestedCount > input.maxLoans) {
    return {
      ok: false,
      reason: `Melebihi batas maksimal peminjaman (${input.maxLoans} buku). Aktif saat ini: ${input.activeLoansCount}.`,
    };
  }
  if (input.isReferenceOnly) {
    return { ok: false, reason: 'Buku referensi hanya untuk dibaca di tempat dan tidak dapat dipinjam keluar.' };
  }
  if (input.readInPlaceOnly) {
    return { ok: false, reason: 'Koleksi ini berstatus baca di tempat.' };
  }
  if (
    input.copyStatus !== 'Tersedia' &&
    !(input.copyStatus === 'Direservasi' && input.reservedForMember)
  ) {
    return { ok: false, reason: `Eksemplar tidak tersedia untuk dipinjam (status saat ini: ${input.copyStatus}).` };
  }
  return { ok: true };
}

export function validateRenewalEligibility(input: RenewalEligibilityInput): EligibilityResult {
  if (input.memberStatus !== 'Aktif') {
    return { ok: false, reason: 'Keanggotaan tidak aktif atau sedang diblokir.' };
  }
  if (input.memberExpiresAt < input.todayStr) {
    return { ok: false, reason: 'Masa berlaku keanggotaan sudah berakhir.' };
  }
  if (input.currentRenewals >= input.maxRenewals) {
    return {
      ok: false,
      reason: `Batas maksimal perpanjangan (${input.maxRenewals} kali) telah tercapai.`,
    };
  }
  if (input.hasActiveReservationQueue) {
    return {
      ok: false,
      reason: 'Buku sedang masuk antrean reservasi anggota lain sehingga tidak dapat diperpanjang.',
    };
  }
  const isOverdue = input.dueDateStr < input.todayStr;
  if (isOverdue && !input.allowOverdueRenewal) {
    return {
      ok: false,
      reason: 'Buku yang sudah melewati tanggal jatuh tempo tidak dapat diperpanjang. Harap lakukan pengembalian.',
    };
  }
  return { ok: true };
}

export function validatePaymentAmount(input: PaymentValidationInput): PaymentValidationResult {
  const remaining = Math.max(0, input.fineAmount - input.paidAmount - input.waivedAmount);
  if (remaining <= 0) {
    return { ok: false, reason: 'Tagihan denda ini sudah lunas atau dibebaskan.' };
  }
  if (!Number.isFinite(input.paymentAmount) || input.paymentAmount <= 0) {
    return { ok: false, reason: 'Nominal pembayaran harus lebih dari Rp 0.' };
  }
  if (input.paymentAmount > remaining) {
    return {
      ok: false,
      reason: `Nominal pembayaran (${formatCurrencyIDR(input.paymentAmount)}) melebihi sisa tagihan (${formatCurrencyIDR(remaining)}).`,
    };
  }
  if (!input.allowPartialPayment && input.paymentAmount < remaining) {
    return {
      ok: false,
      reason: 'Kebijakan perpustakaan mewajibkan pembayaran penuh untuk tagihan ini.',
    };
  }

  const newPaidAmount = input.paidAmount + input.paymentAmount;
  const newRemaining = input.fineAmount - newPaidAmount - input.waivedAmount;
  const newStatus = newRemaining <= 0 ? 'Lunas' : 'Sebagian';

  return {
    ok: true,
    newPaidAmount,
    newStatus,
  };
}

export function computeStockOpnameDiscrepancy(
  expectedCopies: Array<{ id: number; status: string }>,
  scannedItems: Array<{ copy_id: number; physical_status: string }>
) {
  const scannedMap = new Map<number, string>();
  for (const item of scannedItems) {
    scannedMap.set(item.copy_id, item.physical_status);
  }

  let matched = 0;
  let missing = 0;
  let damaged = 0;
  let misplaced = 0;

  for (const copy of expectedCopies) {
    const scan = scannedMap.get(copy.id);
    if (!scan || scan === 'Tidak Ditemukan') {
      if (copy.status !== 'Dipinjam' && copy.status !== 'Hilang' && copy.status !== 'Dihapus') {
        missing++;
      } else {
        matched++;
      }
    } else if (scan === 'Ditemukan') {
      matched++;
    } else if (scan === 'Rusak') {
      damaged++;
    } else if (scan === 'Salah Rak') {
      misplaced++;
    }
  }

  return {
    matched,
    missing,
    damaged,
    misplaced,
    totalDiscrepancy: missing + damaged + misplaced,
  };
}

export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  if (userPermissions.includes('*')) return true;
  return userPermissions.includes(requiredPermission);
}

export function validateBackupPayload(payload: unknown): EligibilityResult {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'Format berkas cadangan tidak valid (bukan objek JSON).' };
  }
  const obj = payload as Record<string, unknown>;
  if (obj.app !== 'Lentera Pustaka') {
    return { ok: false, reason: 'Berkas cadangan bukan berasal dari Lentera Pustaka.' };
  }
  if (typeof obj.version !== 'number' || obj.version < 1) {
    return { ok: false, reason: 'Versi skema cadangan tidak didukung.' };
  }
  const tables = obj.tables as Record<string, unknown> | undefined;
  if (!tables || typeof tables !== 'object') {
    return { ok: false, reason: 'Struktur tabel cadangan tidak ditemukan.' };
  }
  const requiredTables = ['roles', 'users', 'books', 'book_copies', 'members', 'loans'];
  for (const tbl of requiredTables) {
    if (!Array.isArray(tables[tbl])) {
      return { ok: false, reason: `Tabel wajib '${tbl}' hilang atau rusak pada berkas cadangan.` };
    }
  }
  return { ok: true };
}

export function formatCurrencyIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}
