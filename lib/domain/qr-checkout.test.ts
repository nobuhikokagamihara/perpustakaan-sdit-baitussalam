import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQrPayload,
  resolveQrCheckoutScan,
  type QrCopyCandidate,
  type QrMemberCandidate,
} from './qr-checkout';

const SAMPLE_MEMBERS: QrMemberCandidate[] = [
  {
    id: 1,
    member_code: 'AGT-2026-0001',
    full_name: 'Nadia Putri Pratama',
    status: 'Aktif',
    expires_at: '2027-06-30',
    membership_type_name: 'Siswa Reguler',
    active_loans_count: 1,
    max_loans: 3,
    loan_duration_days: 7,
    unpaid_fines_total: 0,
  },
  {
    id: 2,
    member_code: 'AGT-2026-0002',
    full_name: 'Bima Sakti',
    status: 'Diblokir',
    expires_at: '2027-06-30',
    membership_type_name: 'Siswa Reguler',
    active_loans_count: 0,
    max_loans: 3,
    loan_duration_days: 7,
    unpaid_fines_total: 15000,
  },
];

const SAMPLE_COPIES: QrCopyCandidate[] = [
  {
    id: 101,
    inventory_code: 'LP-2026-0001',
    barcode: 'BC20260001',
    status: 'Tersedia',
    book_title: 'Petualangan Sains SD Kelas 4',
    is_reference_only: 0,
    read_in_place_only: 0,
  },
  {
    id: 102,
    inventory_code: 'LP-2026-0002',
    barcode: 'BC20260002',
    status: 'Dipinjam',
    book_title: 'Atlas Nusantara Bergambar',
    is_reference_only: 0,
    read_in_place_only: 0,
  },
  {
    id: 103,
    inventory_code: 'LP-2026-0003',
    barcode: 'BC20260003',
    status: 'Tersedia',
    book_title: 'Kamus Besar Bahasa Indonesia',
    is_reference_only: 1,
    read_in_place_only: 0,
  },
];

test('parseQrPayload extracts plain codes, JSON payloads, prefixes, and URLs', () => {
  assert.deepEqual(parseQrPayload('  AGT-2026-0001  '), {
    raw: 'AGT-2026-0001',
    normalizedCode: 'AGT-2026-0001',
    hint: 'member',
  });

  assert.deepEqual(parseQrPayload('BC20260001'), {
    raw: 'BC20260001',
    normalizedCode: 'BC20260001',
    hint: 'copy',
  });

  assert.deepEqual(parseQrPayload('{"type":"member","code":"AGT-2026-0001"}'), {
    raw: '{"type":"member","code":"AGT-2026-0001"}',
    normalizedCode: 'AGT-2026-0001',
    hint: 'member',
  });

  assert.deepEqual(parseQrPayload('{"barcode":"BC20260001"}'), {
    raw: '{"barcode":"BC20260001"}',
    normalizedCode: 'BC20260001',
    hint: 'copy',
  });

  assert.deepEqual(parseQrPayload('INV:LP-2026-0001'), {
    raw: 'INV:LP-2026-0001',
    normalizedCode: 'LP-2026-0001',
    hint: 'copy',
  });

  assert.deepEqual(parseQrPayload('https://library.test/books?barcode=BC20260001'), {
    raw: 'https://library.test/books?barcode=BC20260001',
    normalizedCode: 'BC20260001',
    hint: 'copy',
  });

  assert.deepEqual(parseQrPayload('lentera://member/AGT-2026-0001'), {
    raw: 'lentera://member/AGT-2026-0001',
    normalizedCode: 'AGT-2026-0001',
    hint: 'member',
  });
});

test('resolveQrCheckoutScan matches member QR and surfaces warnings for blocked members', () => {
  const activeRes = resolveQrCheckoutScan({
    rawText: 'agt-2026-0001',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: null,
    todayStr: '2026-11-17',
  });
  assert.equal(activeRes.ok, true);
  if (activeRes.ok && activeRes.kind === 'member') {
    assert.equal(activeRes.member.id, 1);
    assert.equal(activeRes.warning, undefined);
  }

  const blockedRes = resolveQrCheckoutScan({
    rawText: 'AGT-2026-0002',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: null,
    todayStr: '2026-11-17',
  });
  assert.equal(blockedRes.ok, true);
  if (blockedRes.ok && blockedRes.kind === 'member') {
    assert.equal(blockedRes.member.id, 2);
    assert.match(blockedRes.warning || '', /Diblokir/);
  }
});

test('resolveQrCheckoutScan validates copy availability, duplicates, reference-only, and member quota', () => {
  const okCopy = resolveQrCheckoutScan({
    rawText: 'BC20260001',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: SAMPLE_MEMBERS[0],
    todayStr: '2026-11-17',
  });
  assert.equal(okCopy.ok, true);
  if (okCopy.ok && okCopy.kind === 'copy') {
    assert.equal(okCopy.copy.id, 101);
  }

  const dupCopy = resolveQrCheckoutScan({
    rawText: 'LP-2026-0001',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [101],
    selectedMember: SAMPLE_MEMBERS[0],
    todayStr: '2026-11-17',
  });
  assert.equal(dupCopy.ok, false);
  if (!dupCopy.ok) assert.equal(dupCopy.status, 'duplicate');

  const borrowedCopy = resolveQrCheckoutScan({
    rawText: 'BC20260002',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: SAMPLE_MEMBERS[0],
    todayStr: '2026-11-17',
  });
  assert.equal(borrowedCopy.ok, false);
  if (!borrowedCopy.ok) {
    assert.equal(borrowedCopy.status, 'unavailable');
    assert.match(borrowedCopy.reason, /Dipinjam/);
  }

  const refCopy = resolveQrCheckoutScan({
    rawText: 'BC20260003',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: SAMPLE_MEMBERS[0],
    todayStr: '2026-11-17',
  });
  assert.equal(refCopy.ok, false);
  if (!refCopy.ok) assert.equal(refCopy.status, 'unavailable');

  // Member 1 has active_loans_count = 1, max_loans = 3; with 2 in basket, adding 1 more exceeds max_loans
  const quotaExceeded = resolveQrCheckoutScan({
    rawText: 'BC20260001',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [201, 202],
    selectedMember: SAMPLE_MEMBERS[0],
    todayStr: '2026-11-17',
  });
  assert.equal(quotaExceeded.ok, false);
  if (!quotaExceeded.ok) assert.equal(quotaExceeded.status, 'limit_reached');
});

test('resolveQrCheckoutScan enforces explicit scan mode when set', () => {
  const wrongMode = resolveQrCheckoutScan({
    rawText: 'BC20260001',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: null,
    todayStr: '2026-11-17',
    scanMode: 'member',
  });
  assert.equal(wrongMode.ok, false);
  if (!wrongMode.ok) assert.equal(wrongMode.status, 'wrong_mode');

  const unknownCode = resolveQrCheckoutScan({
    rawText: 'TIDAK-ADA-999',
    members: SAMPLE_MEMBERS,
    copies: SAMPLE_COPIES,
    basketCopyIds: [],
    selectedMember: null,
    todayStr: '2026-11-17',
  });
  assert.equal(unknownCode.ok, false);
  if (!unknownCode.ok) assert.equal(unknownCode.status, 'not_found');
});
