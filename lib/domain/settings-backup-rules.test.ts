import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_BACKUP_TABLES,
  BACKUP_MODULES,
  SCHOOL_ROLE_CATALOG,
  buildBackupEnvelope,
  computeRestoreDiff,
  computeTablesChecksum,
  doesRoleRequireApproval,
  evaluateBackupHealth,
  extractCirculationPolicy,
  extractLibraryIdentity,
  formatBytes,
  guardSuperAdminLockout,
  isStaffOperationalPermissions,
  normalizeSelectedModules,
  parseNumberSetting,
  resolveTablesForModules,
  sha256Hex,
  validateBackupEnvelope,
  validateCustomRoleInput,
  validateMembershipPolicyInput,
  validatePasswordStrength,
  validateSignupInput,
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

test('parseNumberSetting preserves explicit zero and enforces bounds', () => {
  assert.equal(parseNumberSetting('0', 5, 0), 0);
  assert.equal(parseNumberSetting(0, 5, 0), 0);
  assert.equal(parseNumberSetting('', 5, 0), 5);
  assert.equal(parseNumberSetting(undefined, 5, 0), 5);
  assert.equal(parseNumberSetting('-2', 5, 0), 5);
  assert.equal(parseNumberSetting('99', 5, 0, 14), 14);
  assert.equal(parseNumberSetting('3', 1, 1, 30), 3);
});

test('extractLibraryIdentity prefers operational_hours over legacy operating_hours and maps all school fields', () => {
  const fromModern = extractLibraryIdentity({
    library_name: 'Perpustakaan SDN Nusantara 01',
    library_tagline: 'Membaca Membuka Dunia',
    operational_hours: 'Senin–Sabtu 07.30–13.00 WIB',
    operating_hours: 'Lama 07.00–14.00',
    library_address: 'Jl. Merdeka No. 1',
    library_phone: '(021) 888-1234',
    library_email: 'info@sdn1.sch.id',
    library_website: 'https://sdn1.sch.id',
    school_npsn: '20199999',
    principal_name: 'Drs. Budi Santoso',
    librarian_head_name: 'Rina Marlina, S.IP.',
    academic_year: '2027/2028',
    semester: 'Genap',
    enable_opac_public: 'false',
  });
  assert.equal(fromModern.name, 'Perpustakaan SDN Nusantara 01');
  assert.equal(fromModern.operatingHours, 'Senin–Sabtu 07.30–13.00 WIB');
  assert.equal(fromModern.npsn, '20199999');
  assert.equal(fromModern.principalName, 'Drs. Budi Santoso');
  assert.equal(fromModern.librarianHeadName, 'Rina Marlina, S.IP.');
  assert.equal(fromModern.academicYear, '2027/2028');
  assert.equal(fromModern.semester, 'Genap');
  assert.equal(fromModern.enableOpacPublic, false);

  const fromLegacy = extractLibraryIdentity({
    operating_hours: 'Senin–Jumat 08.00–15.00 WIB',
  });
  assert.equal(fromLegacy.operatingHours, 'Senin–Jumat 08.00–15.00 WIB');
  assert.equal(fromLegacy.enableOpacPublic, true);
});

test('extractCirculationPolicy honors explicit zero values, reservation_expiry_days, and boolean switches', () => {
  const policy = extractCirculationPolicy({
    grace_period_days: '0',
    default_damage_fee_percent: '0',
    lost_book_fee_percent: '0',
    block_on_unpaid_fines_limit: '0',
    reservation_expiry_days: '5',
    reservation_pickup_hours: '48',
    auto_reminder_days_before_due: '4',
    allow_partial_fine_payment: 'false',
    allow_overdue_renewal: 'true',
    enable_opac_public: 'false',
    policy_application_mode: 'apply_to_active',
  });
  assert.equal(policy.gracePeriodDays, 0);
  assert.equal(policy.damageFeePercent, 0);
  assert.equal(policy.lostFeePercent, 0);
  assert.equal(policy.blockOnUnpaidFinesLimit, 0);
  assert.equal(policy.reservationExpiryDays, 5);
  assert.equal(policy.autoReminderDaysBeforeDue, 4);
  assert.equal(policy.allowPartialFinePayment, false);
  assert.equal(policy.allowOverdueRenewal, true);
  assert.equal(policy.enableOpacPublic, false);
  assert.equal(policy.policyApplicationMode, 'apply_to_active');

  const legacyFallback = extractCirculationPolicy({
    reservation_pickup_hours: '96',
    notify_due_days_before: '3',
  });
  assert.equal(legacyFallback.reservationExpiryDays, 4);
  assert.equal(legacyFallback.autoReminderDaysBeforeDue, 3);
  assert.equal(legacyFallback.allowPartialFinePayment, true);
  assert.equal(legacyFallback.allowOverdueRenewal, false);
  assert.equal(legacyFallback.policyApplicationMode, 'new_loans_only');
});

test('SCHOOL_ROLE_CATALOG covers whole school community and enforces approval rules for admin/kepala roles', () => {
  const slugs = new Set(SCHOOL_ROLE_CATALOG.map((r) => r.slug));
  for (const expected of [
    'super_admin',
    'kepala_sekolah',
    'wakil_kepala_sekolah',
    'kepala_perpustakaan',
    'admin_perpus',
    'pustakawan',
    'staff_tu',
    'bendahara_sekolah',
    'operator_it',
    'wali_kelas',
    'guru_mapel',
    'guru_pendamping',
    'guru_bk',
    'siswa',
    'duta_literasi',
    'komite_sekolah',
    'petugas_kebersihan_keamanan',
    'anggota',
    'pengunjung',
  ]) {
    assert.ok(slugs.has(expected), `Missing school role ${expected}`);
  }

  assert.equal(doesRoleRequireApproval('admin_perpus'), true);
  assert.equal(doesRoleRequireApproval('kepala_perpustakaan'), true);
  assert.equal(doesRoleRequireApproval('kepala_sekolah'), true);
  assert.equal(doesRoleRequireApproval('siswa'), false);
  assert.equal(doesRoleRequireApproval('wali_kelas'), false);
  assert.equal(doesRoleRequireApproval('komite_sekolah'), false);
  assert.equal(doesRoleRequireApproval('custom_role', 1), true);

  assert.equal(isStaffOperationalPermissions(['books.read', 'loans.read']), false);
  assert.equal(isStaffOperationalPermissions(['dashboard.view', 'books.read']), true);
  assert.equal(isStaffOperationalPermissions(['*']), true);

  assert.equal(
    validateSignupInput({
      fullName: 'Budi Santoso',
      email: 'budi@sd.sch.id',
      password: 'Password123',
      roleSlug: 'super_admin',
    }).ok,
    false
  );
  const validSignup = validateSignupInput({
    fullName: 'Siti Aminah',
    email: 'Siti.Aminah@sd.sch.id',
    password: 'Password123',
    roleSlug: 'kepala_sekolah',
  });
  assert.equal(validSignup.ok, true);
  assert.equal(validSignup.cleanEmail, 'siti.aminah@sd.sch.id');
  assert.equal(validSignup.cleanUsername, 'siti.aminah');
});

test('purge all data enforces strict backup-first prerequisite, recency window, super_admin RBAC, and exact confirmation phrase', async () => {
  const {
    PURGE_CONFIRMATION_PHRASE,
    PURGEABLE_SQLITE_TABLES,
    evaluatePurgeBackupPrerequisite,
    parseUtcTimestampMs,
    validatePurgeAllDataRequest,
  } = await import('./settings-backup-rules');

  const validChecksum = sha256Hex('full-backup-payload');
  const nowIso = '2026-11-20T10:30:00.000Z';

  // Ensure SQLite UTC format parses cleanly
  assert.equal(
    parseUtcTimestampMs('2026-11-20 10:20:00'),
    Date.parse('2026-11-20T10:20:00Z')
  );

  // Critical preserved tables MUST NOT be in PURGEABLE_SQLITE_TABLES
  for (const protectedTbl of [
    'roles',
    'permissions',
    'role_permissions',
    'membership_types',
    'library_settings',
    'backup_snapshots',
    'audit_logs',
    'users',
  ]) {
    assert.ok(
      !PURGEABLE_SQLITE_TABLES.includes(protectedTbl),
      `Protected table ${protectedTbl} must not be blindly wiped`
    );
  }

  // 1. No snapshot -> blocked
  const noSnap = evaluatePurgeBackupPrerequisite([], 420, nowIso, 30);
  assert.equal(noSnap.hasEligibleBackup, false);
  assert.equal(noSnap.operationalRecordCount, 420);
  assert.match(noSnap.reason, /backup penuh/i);

  // 2. Partial snapshot only -> blocked
  const partialOnly = evaluatePurgeBackupPrerequisite(
    [
      {
        id: 1,
        snapshot_code: 'SNP-PARTIAL',
        label: 'Hanya Katalog',
        mode: 'partial',
        checksum: validChecksum,
        total_records: 50,
        created_at: '2026-11-20 10:25:00',
      },
    ],
    420,
    nowIso,
    30
  );
  assert.equal(partialOnly.hasEligibleBackup, false);
  assert.match(partialOnly.reason, /parsial|PENUH/i);

  // 3. Expired full snapshot (45 minutes old > 30 minutes) -> blocked
  const expiredFull = evaluatePurgeBackupPrerequisite(
    [
      {
        id: 2,
        snapshot_code: 'SNP-OLD',
        label: 'Backup Lama',
        mode: 'full',
        checksum: validChecksum,
        total_records: 420,
        created_at: '2026-11-20 09:45:00',
      },
    ],
    420,
    nowIso,
    30
  );
  assert.equal(expiredFull.hasEligibleBackup, false);
  assert.match(expiredFull.reason, /45 menit/i);

  // 4. Invalid checksum -> blocked
  const badChecksum = evaluatePurgeBackupPrerequisite(
    [
      {
        id: 3,
        snapshot_code: 'SNP-BAD',
        label: 'Checksum Rusak',
        mode: 'full',
        checksum: 'not-a-sha256',
        total_records: 420,
        created_at: '2026-11-20 10:25:00',
      },
    ],
    420,
    nowIso,
    30
  );
  assert.equal(badChecksum.hasEligibleBackup, false);
  assert.match(badChecksum.reason, /SHA-256/i);

  // 5. Fresh valid full snapshot (10 minutes old) -> eligible!
  const freshSnap = {
    id: 4,
    snapshot_code: 'SNP-FRESH-01',
    label: 'Backup Penuh Pra-Hapus',
    mode: 'full',
    checksum: validChecksum,
    total_records: 420,
    created_at: '2026-11-20 10:20:00',
  };
  const eligible = evaluatePurgeBackupPrerequisite([freshSnap], 420, nowIso, 30);
  assert.equal(eligible.hasEligibleBackup, true);
  assert.equal(eligible.eligibleSnapshot?.snapshot_code, 'SNP-FRESH-01');
  assert.equal(eligible.eligibleSnapshot?.ageMinutes, 10);
  assert.equal(eligible.eligibleSnapshot?.expiresInMinutes, 20);

  // 6. Non-super_admin rejected even with valid backup & phrase
  const nonAdmin = validatePurgeAllDataRequest({
    actorRoleSlug: 'kepala_perpustakaan',
    confirmationPhrase: PURGE_CONFIRMATION_PHRASE,
    acknowledgeIrreversible: true,
    prerequisiteSnapshot: freshSnap,
    nowIso,
  });
  assert.equal(nonAdmin.ok, false);
  assert.match(nonAdmin.reason || '', /Super Admin/i);

  // 7. Missing checkbox acknowledgment rejected
  const noAck = validatePurgeAllDataRequest({
    actorRoleSlug: 'super_admin',
    confirmationPhrase: PURGE_CONFIRMATION_PHRASE,
    acknowledgeIrreversible: false,
    prerequisiteSnapshot: freshSnap,
    nowIso,
  });
  assert.equal(noAck.ok, false);

  // 8. Wrong confirmation phrase rejected (including lowercase)
  const wrongPhrase = validatePurgeAllDataRequest({
    actorRoleSlug: 'super_admin',
    confirmationPhrase: 'hapus semua data',
    acknowledgeIrreversible: true,
    prerequisiteSnapshot: freshSnap,
    nowIso,
  });
  assert.equal(wrongPhrase.ok, false);
  assert.match(wrongPhrase.reason || '', /HAPUS SEMUA DATA/);

  // 9. All conditions satisfied -> accepted
  const validPurge = validatePurgeAllDataRequest({
    actorRoleSlug: 'super_admin',
    confirmationPhrase: '  HAPUS SEMUA DATA  ',
    acknowledgeIrreversible: true,
    prerequisiteSnapshot: freshSnap,
    nowIso,
  });
  assert.equal(validPurge.ok, true);
  assert.equal(validPurge.ageMinutes, 10);
});


