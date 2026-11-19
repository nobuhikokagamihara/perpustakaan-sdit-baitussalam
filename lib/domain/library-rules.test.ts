import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDueDate,
  calculateOverdueDays,
  calculateFineAmount,
  validateLoanEligibility,
  validateRenewalEligibility,
  validatePaymentAmount,
  computeStockOpnameDiscrepancy,
  hasPermission,
  validateBackupPayload,
} from './library-rules';

test('calculateDueDate adds duration correctly across month boundaries', () => {
  assert.equal(calculateDueDate('2026-11-28', 7), '2026-12-05');
  assert.equal(calculateDueDate('2026-02-25', 5), '2026-03-02');
});

test('calculateOverdueDays respects grace period', () => {
  assert.equal(calculateOverdueDays('2026-11-10', '2026-11-10', 1), 0);
  assert.equal(calculateOverdueDays('2026-11-10', '2026-11-11', 1), 0);
  assert.equal(calculateOverdueDays('2026-11-10', '2026-11-12', 1), 2);
  assert.equal(calculateOverdueDays('2026-11-10', '2026-11-08', 0), 0);
});

test('calculateFineAmount caps late fine and calculates damage/loss fees', () => {
  const capped = calculateFineAmount({
    overdueDays: 40,
    dailyRate: 2000,
    maxCap: 50000,
    condition: 'Baik',
    bookPrice: 120000,
    damageFeePercent: 50,
  });
  assert.equal(capped.lateFine, 50000);
  assert.equal(capped.damageFine, 0);
  assert.equal(capped.totalFine, 50000);

  const lost = calculateFineAmount({
    overdueDays: 3,
    dailyRate: 2000,
    maxCap: 50000,
    condition: 'Hilang',
    bookPrice: 120000,
    damageFeePercent: 50,
  });
  assert.equal(lost.lateFine, 6000);
  assert.equal(lost.damageFine, 120000);
  assert.equal(lost.totalFine, 126000);

  const lostCustomPct = calculateFineAmount({
    overdueDays: 0,
    dailyRate: 2000,
    maxCap: 50000,
    condition: 'Hilang',
    bookPrice: 120000,
    damageFeePercent: 50,
    lostFeePercent: 80,
  });
  assert.equal(lostCustomPct.damageFine, 96000);
  assert.equal(lostCustomPct.totalFine, 96000);
});

test('validateLoanEligibility blocks invalid members, limits, reference books, and borrowed copies', () => {
  const base = {
    memberStatus: 'Aktif' as const,
    memberExpiresAt: '2027-01-01',
    activeLoansCount: 1,
    maxLoans: 3,
    requestedCount: 1,
    copyStatus: 'Tersedia' as const,
    isReferenceOnly: false,
    readInPlaceOnly: false,
    todayStr: '2026-11-17',
    unpaidFinesTotal: 0,
    blockOnUnpaidFinesLimit: 50000,
  };

  assert.equal(validateLoanEligibility(base).ok, true);
  assert.equal(validateLoanEligibility({ ...base, memberStatus: 'Diblokir' }).ok, false);
  assert.equal(validateLoanEligibility({ ...base, memberExpiresAt: '2026-10-01' }).ok, false);
  assert.equal(validateLoanEligibility({ ...base, activeLoansCount: 3, requestedCount: 1 }).ok, false);
  assert.equal(validateLoanEligibility({ ...base, copyStatus: 'Dipinjam' }).ok, false);
  assert.equal(validateLoanEligibility({ ...base, copyStatus: 'Direservasi' }).ok, false);
  assert.equal(
    validateLoanEligibility({ ...base, copyStatus: 'Direservasi', reservedForMember: true }).ok,
    true
  );
  assert.equal(validateLoanEligibility({ ...base, isReferenceOnly: true }).ok, false);
  assert.equal(validateLoanEligibility({ ...base, unpaidFinesTotal: 55000 }).ok, false);
});

test('validateRenewalEligibility checks reservation queue, limit, and overdue policy', () => {
  const base = {
    memberStatus: 'Aktif' as const,
    memberExpiresAt: '2027-01-01',
    todayStr: '2026-11-17',
    currentRenewals: 0,
    maxRenewals: 2,
    dueDateStr: '2026-11-20',
    hasActiveReservationQueue: false,
    allowOverdueRenewal: false,
  };

  assert.equal(validateRenewalEligibility(base).ok, true);
  assert.equal(validateRenewalEligibility({ ...base, currentRenewals: 2 }).ok, false);
  assert.equal(validateRenewalEligibility({ ...base, hasActiveReservationQueue: true }).ok, false);
  assert.equal(validateRenewalEligibility({ ...base, dueDateStr: '2026-11-15' }).ok, false);
  assert.equal(
    validateRenewalEligibility({ ...base, dueDateStr: '2026-11-15', allowOverdueRenewal: true }).ok,
    true
  );
});

test('validatePaymentAmount prevents overpayment and honors partial payment policy', () => {
  assert.deepEqual(
    validatePaymentAmount({
      fineAmount: 10000,
      paidAmount: 0,
      waivedAmount: 0,
      paymentAmount: 4000,
      allowPartialPayment: true,
    }),
    { ok: true, newPaidAmount: 4000, newStatus: 'Sebagian' }
  );

  assert.equal(
    validatePaymentAmount({
      fineAmount: 10000,
      paidAmount: 0,
      waivedAmount: 0,
      paymentAmount: 4000,
      allowPartialPayment: false,
    }).ok,
    false
  );

  assert.equal(
    validatePaymentAmount({
      fineAmount: 10000,
      paidAmount: 6000,
      waivedAmount: 0,
      paymentAmount: 5000,
      allowPartialPayment: true,
    }).ok,
    false
  );
});

test('computeStockOpnameDiscrepancy accurately classifies missing, damaged, and misplaced copies', () => {
  const result = computeStockOpnameDiscrepancy(
    [
      { id: 1, status: 'Tersedia' },
      { id: 2, status: 'Tersedia' },
      { id: 3, status: 'Dipinjam' },
      { id: 4, status: 'Tersedia' },
    ],
    [
      { copy_id: 1, physical_status: 'Ditemukan' },
      { copy_id: 2, physical_status: 'Rusak' },
    ]
  );

  assert.equal(result.matched, 2); // copy 1 found + copy 3 legitimately borrowed
  assert.equal(result.damaged, 1); // copy 2
  assert.equal(result.missing, 1); // copy 4 missing
  assert.equal(result.totalDiscrepancy, 2);
});

test('hasPermission and validateBackupPayload validate RBAC and backup structure', () => {
  assert.equal(hasPermission(['books.read', 'loans.write'], 'loans.write'), true);
  assert.equal(hasPermission(['books.read'], 'fines.waive'), false);
  assert.equal(hasPermission(['*'], 'settings.write'), true);

  assert.equal(validateBackupPayload(null).ok, false);
  assert.equal(
    validateBackupPayload({
      app: 'Lentera Pustaka',
      version: 1,
      tables: {
        roles: [],
        users: [],
        books: [],
        book_copies: [],
        members: [],
        loans: [],
      },
    }).ok,
    true
  );
});
