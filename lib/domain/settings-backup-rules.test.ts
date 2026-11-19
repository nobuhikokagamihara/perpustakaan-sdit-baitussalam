import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_BACKUP_TABLES,
  BACKUP_MODULES,
  buildBackupEnvelope,
  computeRestoreDiff,
  computeTablesChecksum,
  evaluateBackupHealth,
  formatBytes,
  guardSuperAdminLockout,
  normalizeSelectedModules,
  resolveTablesForModules,
  sha256Hex,
  validateBackupEnvelope,
  validateCustomRoleInput,
  validateMembershipPolicyInput,
  validatePasswordStrength,
} from './settings-backup-rules';

test('sha256Hex matches standard FIPS 180-4 test vectors', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    sha256Hex('Lentera Pustaka'),
    sha256Hex('Lentera Pustaka')
  );
});

test('ALL_BACKUP_TABLES covers all module tables including reading_schedules and class rosters', () => {
  const fromModules = new Set(BACKUP_MODULES.flatMap((m) => m.sqliteTables));
  for (const tbl of fromModules) {
    assert.ok(ALL_BACKUP_TABLES.includes(tbl), `Missing ${tbl} in ALL_BACKUP_TABLES`);
  }
  for (const critical of [
    'reading_schedules',
    'reading_schedule_logs',
    'school_classes',
    'class_students',
    'reading_session_attendance',
    'books',
    'book_copies',
    'library_settings',
  ]) {
    assert.ok(ALL_BACKUP_TABLES.includes(critical));
  }
});

test('buildBackupEnvelope & validateBackupEnvelope verify SHA-256 integrity and detect tampering', () => {
  const envelope = buildBackupEnvelope({
    backupId: 'BKP-2026-0001',
    label: 'Backup Harian Lengkap',
    sourceEngine: 'sqlite',
    exportedBy: 'Super Admin',
    selectedModules: normalizeSelectedModules(undefined, false),
    tables: {
      books: [{ id: 1, title: 'Petualangan Sains SD' }],
      book_copies: [{ id: 1, barcode: 'LP-001' }],
      members: [{ id: 1, full_name: 'Nadia' }],
      loans: [],
      roles: [{ id: 1, slug: 'super_admin' }],
    },
  });

  assert.equal(envelope.version, 2);
  assert.equal(envelope.mode, 'full');
  assert.equal(envelope.totalRecords, 4);
  assert.equal(envelope.checksum.length, 64);

  const valid = validateBackupEnvelope(envelope);
  assert.equal(valid.ok, true);
  assert.equal(valid.checksumStatus, 'verified');
  assert.equal(valid.totalRecords, 4);

  // Tamper one field inside tables without recalculating checksum
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.tables.books[0].title = 'Buku Dimodifikasi';
  const rejected = validateBackupEnvelope(tampered);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.checksumStatus, 'mismatch');
  assert.match(rejected.reason || '', /SHA-256/i);
});

test('validateBackupEnvelope remains backward-compatible with legacy v1 backups', () => {
  const v1 = {
    app: 'Lentera Pustaka',
    version: 1,
    exportedAt: '2026-10-01T00:00:00.000Z',
    tables: {
      roles: [{ id: 1, slug: 'super_admin' }],
      users: [{ id: 1, username: 'admin' }],
      books: [{ id: 1, title: 'Buku A' }],
      book_copies: [{ id: 1, barcode: 'BC1' }],
      members: [{ id: 1, full_name: 'Budi' }],
      loans: [],
    },
  };
  const res = validateBackupEnvelope(v1);
  assert.equal(res.ok, true);
  assert.equal(res.version, 1);
  assert.equal(res.checksumStatus, 'legacy_no_checksum');
  assert.equal(res.totalRecords, 5);
});

test('computeTablesChecksum is invariant to object key ordering', () => {
  const a = computeTablesChecksum({
    books: [{ title: 'A', id: 1 }],
    members: [{ name: 'B', id: 2 }],
  });
  const b = computeTablesChecksum({
    members: [{ id: 2, name: 'B' }],
    books: [{ id: 1, title: 'A' }],
  });
  assert.equal(a, b);
});

test('selective module resolution and restore diff computation work accurately', () => {
  const mods = normalizeSelectedModules(['catalog', 'schedules'], false);
  assert.deepEqual(mods, ['catalog', 'schedules']);
  const tables = resolveTablesForModules(mods);
  assert.ok(tables.includes('books'));
  assert.ok(tables.includes('reading_schedules'));
  assert.ok(!tables.includes('loans'));
  assert.ok(!tables.includes('audit_logs'));

  const diff = computeRestoreDiff(
    { books: 10, book_copies: 25, reading_schedules: 12 },
    { books: [{ id: 1 }, { id: 2 }], book_copies: [{ id: 1 }], reading_schedules: Array(15).fill({}) },
    mods
  );
  assert.equal(diff.length, 2);
  const catalogDiff = diff.find((d) => d.moduleId === 'catalog')!;
  assert.equal(catalogDiff.currentRows, 35);
  assert.equal(catalogDiff.backupRows, 3);
  assert.equal(catalogDiff.delta, -32);
  const schedDiff = diff.find((d) => d.moduleId === 'schedules')!;
  assert.equal(schedDiff.delta, 3);
});

test('evaluateBackupHealth flags never backed up, aging, and healthy states', () => {
  const never = evaluateBackupHealth(null, 'weekly', '2026-11-18T10:00:00.000Z');
  assert.equal(never.status, 'Belum Pernah');

  const healthy = evaluateBackupHealth('2026-11-17T10:00:00.000Z', 'weekly', '2026-11-18T10:00:00.000Z');
  assert.equal(healthy.status, 'Sehat');
  assert.equal(healthy.daysSinceLast, 1);

  const aging = evaluateBackupHealth('2026-11-01T10:00:00.000Z', 'weekly', '2026-11-18T10:00:00.000Z');
  assert.equal(aging.status, 'Perlu Backup');
  assert.equal(aging.daysSinceLast, 17);
});

test('RBAC & policy validators block lockout, invalid roles, bad policies, and weak passwords', () => {
  const lockout = guardSuperAdminLockout('super_admin', ['books.read']);
  assert.equal(lockout.ok, false);
  assert.ok(lockout.enforcedCodes.includes('settings.write'));

  const okAdmin = guardSuperAdminLockout('super_admin', ['settings.read', 'settings.write']);
  assert.equal(okAdmin.ok, true);

  assert.equal(validateCustomRoleInput({ name: 'Super Admin', slug: 'super_admin' }).ok, false);
  const customOk = validateCustomRoleInput({ name: 'Guru Pendamping Literasi' });
  assert.equal(customOk.ok, true);
  assert.equal(customOk.normalizedSlug, 'guru_pendamping_literasi');

  assert.equal(
    validateMembershipPolicyInput({
      code: 'SISWA_RENDAH',
      name: 'Siswa Kelas 1–3',
      max_loans: 3,
      loan_duration_days: 7,
      max_renewals: 1,
      daily_fine_rate: 500,
      max_fine_cap: 15000,
    }).ok,
    true
  );
  assert.equal(
    validateMembershipPolicyInput({
      code: 'BAD',
      name: 'Bad Policy',
      max_loans: 3,
      loan_duration_days: 7,
      max_renewals: 1,
      daily_fine_rate: 5000,
      max_fine_cap: 2000,
    }).ok,
    false
  );

  assert.equal(validatePasswordStrength('short1').ok, false);
  assert.equal(validatePasswordStrength('onlyletters').ok, false);
  assert.equal(validatePasswordStrength('Lentera2026').ok, true);

  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1_572_864), '1.50 MB');
});
