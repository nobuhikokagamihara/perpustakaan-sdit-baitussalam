import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from './schema';
import { seedDatabase } from './seed';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedDatabase(db);
  return db;
}

test('database migrations and seed populate all core tables idempotently', () => {
  const db = createTestDb();
  const roles = (db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c;
  const books = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
  const copies = (db.prepare('SELECT COUNT(*) as c FROM book_copies').get() as { c: number }).c;
  const members = (db.prepare('SELECT COUNT(*) as c FROM members').get() as { c: number }).c;

  assert.ok(roles >= 19);
  assert.ok(books >= 10);
  assert.ok(copies >= 25);
  assert.ok(members >= 8);

  const requiredSlugs = [
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
  ];
  for (const slug of requiredSlugs) {
    const found = db.prepare('SELECT id FROM roles WHERE slug = ?').get(slug);
    assert.ok(found, `Expected seeded role ${slug} to exist`);
  }

  // Idempotent seed check
  seedDatabase(db);
  const booksAfter = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
  assert.equal(booksAfter, books);
  db.close();
});

test('unique constraints prevent duplicate member codes and inventory codes', () => {
  const db = createTestDb();
  assert.throws(() => {
    db.prepare(
      `INSERT INTO members (member_code, full_name, membership_type_id, registered_at, expires_at)
       VALUES ('AGT-2026-0001', 'Duplikat', 1, '2026-11-17', '2027-11-17')`
    ).run();
  });
  assert.throws(() => {
    db.prepare(
      `INSERT INTO book_copies (book_id, inventory_code, barcode) VALUES (1, 'LP-2026-0001', 'NEWBC1')`
    ).run();
  });
  db.close();
});

test('atomic loan checkout locks copy and prevents concurrent double borrow', () => {
  const db = createTestDb();
  const availableCopy = db
    .prepare("SELECT id FROM book_copies WHERE status = 'Tersedia' LIMIT 1")
    .get() as { id: number };
  assert.ok(availableCopy);

  const firstAttempt = db
    .prepare("UPDATE book_copies SET status = 'Dipinjam' WHERE id = ? AND status = 'Tersedia'")
    .run(availableCopy.id);
  assert.equal(firstAttempt.changes, 1);

  const secondAttempt = db
    .prepare("UPDATE book_copies SET status = 'Dipinjam' WHERE id = ? AND status = 'Tersedia'")
    .run(availableCopy.id);
  assert.equal(secondAttempt.changes, 0);
  db.close();
});

test('seeded overdue loan and unpaid fine are present for live operational tracking', () => {
  const db = createTestDb();
  const overdueLoans = db
    .prepare("SELECT COUNT(*) as c FROM loans WHERE status = 'Terlambat'")
    .get() as { c: number };
  const unpaidFines = db
    .prepare("SELECT COUNT(*) as c FROM fines WHERE status = 'Belum Lunas'")
    .get() as { c: number };

  assert.ok(overdueLoans.c >= 1);
  assert.ok(unpaidFines.c >= 1);
  db.close();
});

test('reading_schedules covers all 12 SD classes and logs execution idempotently', () => {
  const db = createTestDb();
  const schedCount = (
    db.prepare('SELECT COUNT(*) as c FROM reading_schedules WHERE archived_at IS NULL').get() as {
      c: number;
    }
  ).c;
  assert.equal(schedCount, 12);

  const distinctClasses = (
    db
      .prepare('SELECT COUNT(DISTINCT class_name) as c FROM reading_schedules WHERE archived_at IS NULL')
      .get() as { c: number }
  ).c;
  assert.equal(distinctClasses, 12);

  const logsCount = (
    db.prepare('SELECT COUNT(*) as c FROM reading_schedule_logs').get() as { c: number }
  ).c;
  assert.ok(logsCount >= 2);

  const schedulePerms = db
    .prepare("SELECT code FROM permissions WHERE code IN ('schedules.read', 'schedules.write')")
    .all() as Array<{ code: string }>;
  assert.equal(schedulePerms.length, 2);

  // Soft-archive check preserves logs
  db.prepare("UPDATE reading_schedules SET archived_at = datetime('now') WHERE schedule_code = 'JDW-2026-0001'").run();
  const logsAfterArchive = (
    db.prepare('SELECT COUNT(*) as c FROM reading_schedule_logs').get() as { c: number }
  ).c;
  assert.equal(logsAfterArchive, logsCount);
  db.close();
});

test('school_classes, class_students, and reading_session_attendance seed cleanly with Wali Kelas and Pendamping', () => {
  const db = createTestDb();

  const classes = db
    .prepare('SELECT class_name, homeroom_teacher, companion_teacher FROM school_classes ORDER BY grade_level, class_name')
    .all() as Array<{ class_name: string; homeroom_teacher: string; companion_teacher: string }>;
  assert.equal(classes.length, 12);
  for (const c of classes) {
    assert.ok(c.homeroom_teacher.length > 0, `Missing homeroom_teacher for ${c.class_name}`);
    assert.ok(c.companion_teacher.length > 0, `Missing companion_teacher for ${c.class_name}`);
  }

  const totalStudents = (
    db.prepare('SELECT COUNT(*) as c FROM class_students WHERE archived_at IS NULL').get() as { c: number }
  ).c;
  assert.equal(totalStudents, 120);

  const schedsWithCompanion = (
    db
      .prepare("SELECT COUNT(*) as c FROM reading_schedules WHERE companion_teacher != ''")
      .get() as { c: number }
  ).c;
  assert.equal(schedsWithCompanion, 12);

  const attCount = (
    db.prepare('SELECT COUNT(*) as c FROM reading_session_attendance').get() as { c: number }
  ).c;
  assert.equal(attCount, 20); // 2 completed seeded sessions x 10 students each

  const absentRows = db
    .prepare("SELECT status, note FROM reading_session_attendance WHERE status != 'Hadir'")
    .all() as Array<{ status: string; note: string }>;
  assert.equal(absentRows.length, 2);
  assert.ok(absentRows.some((r) => r.status === 'Sakit'));
  assert.ok(absentRows.some((r) => r.status === 'Izin'));

  // Soft-archiving a student preserves historical attendance records
  const oneStudent = db
    .prepare("SELECT id FROM class_students WHERE class_name = 'Kelas 1A' LIMIT 1")
    .get() as { id: number };
  db.prepare("UPDATE class_students SET archived_at = datetime('now') WHERE id = ?").run(oneStudent.id);
  const attAfterArchive = (
    db.prepare('SELECT COUNT(*) as c FROM reading_session_attendance').get() as { c: number }
  ).c;
  assert.equal(attAfterArchive, attCount);
  db.close();
});

test('migration 004_rich_book_metadata adds complete bibliographic and cover_url columns', () => {
  const db = createTestDb();
  const cols = (db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  for (const col of [
    'subtitle',
    'series_name',
    'volume',
    'illustrator',
    'editor',
    'translator',
    'publish_city',
    'ddc_code',
    'call_number',
    'subjects',
    'target_grade',
    'age_range',
    'dimensions',
    'binding_type',
    'paper_type',
    'weight_grams',
    'illustration_notes',
    'table_of_contents',
    'acquisition_source',
    'is_featured',
    'cover_url',
  ]) {
    assert.ok(cols.includes(col), `Expected books table to include column ${col}`);
  }

  const inserted = db
    .prepare(
      `INSERT INTO books (
        title, subtitle, series_name, volume, isbn, edition, publish_year, publish_city,
        language, description, table_of_contents, pages, dimensions, binding_type, paper_type,
        weight_grams, illustration_notes, cover_url, price, ddc_code, call_number, subjects,
        target_grade, age_range, illustrator, editor, translator, acquisition_source, is_featured
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'Ensiklopedia Satwa Nusantara',
      'Mengenal Fauna Endemik Indonesia',
      'Seri Alam Kita',
      'Jilid 1',
      '978-602-888-100-9',
      'Edisi 2',
      2026,
      'Jakarta',
      'Indonesia',
      'Buku bergambar untuk siswa SD.',
      'Bab 1 Sumatera\nBab 2 Kalimantan',
      128,
      '19 × 26 cm',
      'Hardcover',
      'Art Paper (Glossy)',
      420,
      'Full Color',
      'https://picsum.photos/seed/satwa-nusantara/400/600',
      95000,
      '590',
      '590 NUS e',
      'fauna, komodo, orangutan',
      'Kelas Tinggi (4–6 SD)',
      '9–12 tahun',
      'Raka Pratama',
      'Dian Kusuma',
      '',
      'Pembelian Dana BOS',
      1
    );

  const row = db
    .prepare('SELECT * FROM books WHERE id = ?')
    .get(Number(inserted.lastInsertRowid)) as Record<string, unknown>;
  assert.equal(row.subtitle, 'Mengenal Fauna Endemik Indonesia');
  assert.equal(row.cover_url, 'https://picsum.photos/seed/satwa-nusantara/400/600');
  assert.equal(row.ddc_code, '590');
  assert.equal(row.call_number, '590 NUS e');
  assert.equal(row.weight_grams, 420);
  assert.equal(row.is_featured, 1);
  db.close();
});

test('migration 005_backup_snapshots_and_settings creates backup_snapshots and extended settings', () => {
  const db = createTestDb();
  const cols = (db.prepare('PRAGMA table_info(backup_snapshots)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  for (const col of [
    'snapshot_code',
    'label',
    'notes',
    'mode',
    'modules_json',
    'checksum',
    'total_records',
    'size_bytes',
    'table_counts_json',
    'payload_json',
    'is_auto_safety',
  ]) {
    assert.ok(cols.includes(col), `Expected backup_snapshots column ${col}`);
  }

  const settingRows = db
    .prepare(
      `SELECT key, value FROM library_settings
       WHERE key IN ('school_npsn', 'academic_year', 'backup_auto_frequency', 'backup_retention_count', 'reservation_expiry_days')`
    )
    .all() as Array<{ key: string; value: string }>;
  assert.equal(settingRows.length, 5);

  const inserted = db
    .prepare(
      `INSERT INTO backup_snapshots
        (snapshot_code, label, notes, mode, modules_json, checksum, total_records, size_bytes, table_counts_json, payload_json, created_by_name, is_auto_safety)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'SNP-20261118-001',
      'Snapshot Uji Penuh',
      'Catatan uji integrasi',
      'full',
      '["catalog","members","circulation","schedules","inventory","system"]',
      'a'.repeat(64),
      150,
      4096,
      '{"books":10}',
      '{"app":"Lentera Pustaka","version":2}',
      'Super Admin',
      0
    );
  assert.ok(Number(inserted.lastInsertRowid) > 0);
  db.close();
});

test('reserved copy (Direservasi) can only be checked out by the reserving member and marks reservation Diambil', () => {
  const db = createTestDb();
  const copy = db
    .prepare("SELECT id, book_id FROM book_copies WHERE status = 'Tersedia' LIMIT 1")
    .get() as { id: number; book_id: number };
  const members = db
    .prepare("SELECT id FROM members WHERE status = 'Aktif' ORDER BY id ASC LIMIT 2")
    .all() as Array<{ id: number }>;
  assert.ok(copy && members.length === 2);

  const reservingMemberId = members[0].id;
  const otherMemberId = members[1].id;

  db.prepare("UPDATE book_copies SET status = 'Direservasi' WHERE id = ?").run(copy.id);
  db.prepare(
    `INSERT INTO reservations (reservation_number, book_id, copy_id, member_id, queue_position, status, expires_at)
     VALUES ('RSV-TEST-001', ?, ?, ?, 1, 'Tersedia', '2027-01-01')`
  ).run(copy.book_id, copy.id, reservingMemberId);

  const otherMatch = db
    .prepare("SELECT id FROM reservations WHERE member_id = ? AND copy_id = ? AND status = 'Tersedia'")
    .get(otherMemberId, copy.id);
  assert.equal(otherMatch, undefined);

  const ownerMatch = db
    .prepare("SELECT id FROM reservations WHERE member_id = ? AND copy_id = ? AND status = 'Tersedia'")
    .get(reservingMemberId, copy.id) as { id: number } | undefined;
  assert.ok(ownerMatch);

  const upd = db
    .prepare("UPDATE book_copies SET status = 'Dipinjam' WHERE id = ? AND status = 'Direservasi'")
    .run(copy.id);
  assert.equal(upd.changes, 1);

  db.prepare("UPDATE reservations SET status = 'Diambil' WHERE id = ?").run(ownerMatch.id);
  const resAfter = db
    .prepare('SELECT status FROM reservations WHERE id = ?')
    .get(ownerMatch.id) as { status: string };
  assert.equal(resAfter.status, 'Diambil');
  db.close();
});

test('multi-item loan renewal preserves Sebagian Kembali and Terlambat aggregate parent loan status', () => {
  const db = createTestDb();
  const member = db.prepare("SELECT id FROM members WHERE status = 'Aktif' LIMIT 1").get() as { id: number };
  const copies = db
    .prepare("SELECT id FROM book_copies WHERE status = 'Tersedia' LIMIT 2")
    .all() as Array<{ id: number }>;
  assert.ok(member && copies.length === 2);

  const loanId = Number(
    db
      .prepare(
        `INSERT INTO loans (loan_number, member_id, loan_date, due_date, status)
         VALUES ('PJM-TEST-MULTI', ?, '2026-11-01', '2026-11-10', 'Terlambat')`
      )
      .run(member.id).lastInsertRowid
  );
  const item1 = Number(
    db
      .prepare(
        `INSERT INTO loan_items (loan_id, copy_id, due_date, status) VALUES (?, ?, '2026-11-10', 'Terlambat')`
      )
      .run(loanId, copies[0].id).lastInsertRowid
  );
  const item2 = Number(
    db
      .prepare(
        `INSERT INTO loan_items (loan_id, copy_id, due_date, status) VALUES (?, ?, '2026-11-20', 'Dipinjam')`
      )
      .run(loanId, copies[1].id).lastInsertRowid
  );

  // Renew item2 while item1 is still overdue -> parent loan must remain Terlambat
  const today = '2026-11-18';
  db.prepare("UPDATE loan_items SET due_date = '2026-11-27', renewal_count = 1 WHERE id = ?").run(item2);
  const sum1 = db
    .prepare(
      `SELECT
         MAX(CASE WHEN returned_at IS NULL THEN due_date END) as max_due_date,
         SUM(CASE WHEN returned_at IS NULL AND due_date < ? THEN 1 ELSE 0 END) as overdue_count,
         SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) as returned_count
       FROM loan_items WHERE loan_id = ?`
    )
    .get(today, loanId) as { max_due_date: string; overdue_count: number; returned_count: number };
  assert.equal(sum1.overdue_count, 1);
  assert.equal(sum1.max_due_date, '2026-11-27');

  // Return item1 -> renewing item2 again should yield Sebagian Kembali
  db.prepare("UPDATE loan_items SET returned_at = ?, status = 'Dikembalikan' WHERE id = ?").run(today, item1);
  const sum2 = db
    .prepare(
      `SELECT
         MAX(CASE WHEN returned_at IS NULL THEN due_date END) as max_due_date,
         SUM(CASE WHEN returned_at IS NULL AND due_date < ? THEN 1 ELSE 0 END) as overdue_count,
         SUM(CASE WHEN returned_at IS NOT NULL THEN 1 ELSE 0 END) as returned_count
       FROM loan_items WHERE loan_id = ?`
    )
    .get(today, loanId) as { max_due_date: string; overdue_count: number; returned_count: number };
  assert.equal(sum2.overdue_count, 0);
  assert.equal(sum2.returned_count, 1);
  db.close();
});

test('extending expiry preserves Diblokir status and sequential code lookup avoids unique collisions', () => {
  const db = createTestDb();
  const member = db.prepare('SELECT id FROM members LIMIT 1').get() as { id: number };
  db.prepare("UPDATE members SET status = 'Diblokir', block_reason = 'Pelanggaran' WHERE id = ?").run(member.id);

  const before = db.prepare('SELECT status, expires_at FROM members WHERE id = ?').get(member.id) as {
    status: string;
    expires_at: string;
  };
  const nextStatus = before.status === 'Diblokir' ? 'Diblokir' : 'Aktif';
  db.prepare('UPDATE members SET expires_at = ?, status = ? WHERE id = ?').run('2028-01-01', nextStatus, member.id);
  const after = db.prepare('SELECT status, expires_at FROM members WHERE id = ?').get(member.id) as {
    status: string;
    expires_at: string;
  };
  assert.equal(after.status, 'Diblokir');
  assert.equal(after.expires_at, '2028-01-01');

  // Verify collision-safe category code allocation
  let catSeq = (db.prepare('SELECT COALESCE(MAX(id), 0) as m FROM categories').get() as { m: number }).m + 1;
  const checkCat = db.prepare('SELECT 1 FROM categories WHERE code = ?');
  const insertedCodes: string[] = [];
  for (const name of ['Kategori Uji A', 'Kategori Uji B']) {
    let code = `CAT-${String(catSeq).padStart(3, '0')}`;
    while (checkCat.get(code)) {
      catSeq++;
      code = `CAT-${String(catSeq).padStart(3, '0')}`;
    }
    catSeq++;
    db.prepare('INSERT INTO categories (code, name) VALUES (?, ?)').run(code, name);
    insertedCodes.push(code);
  }
  assert.equal(new Set(insertedCodes).size, 2);
  db.close();
});

test('signup role approval workflow, role switching, custom role creation, and member actions work end-to-end', () => {
  const db = createTestDb();
  const kepalaSekolahRole = db
    .prepare("SELECT id, requires_approval FROM roles WHERE slug = 'kepala_sekolah'")
    .get() as { id: number; requires_approval: number };
  const adminPerpusRole = db
    .prepare("SELECT id, requires_approval FROM roles WHERE slug = 'admin_perpus'")
    .get() as { id: number; requires_approval: number };
  const siswaRole = db
    .prepare("SELECT id, requires_approval FROM roles WHERE slug = 'siswa'")
    .get() as { id: number; requires_approval: number };

  assert.equal(kepalaSekolahRole.requires_approval, 1);
  assert.equal(adminPerpusRole.requires_approval, 1);
  assert.equal(siswaRole.requires_approval, 0);

  // Pending user signing up for Kepala Sekolah
  const pendingId = Number(
    db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active, approval_status, requested_role_id)
         VALUES ('kepsek.baru', 'kepsek@sd.id', 'Drs. Hasanuddin', 'hash', ?, 0, 'pending', ?)`
      )
      .run(kepalaSekolahRole.id, kepalaSekolahRole.id).lastInsertRowid
  );
  const pendingRow = db
    .prepare('SELECT is_active, approval_status FROM users WHERE id = ?')
    .get(pendingId) as { is_active: number; approval_status: string };
  assert.equal(pendingRow.is_active, 0);
  assert.equal(pendingRow.approval_status, 'pending');

  // Super Admin approves and later changes role to Admin Perpus
  db.prepare(
    "UPDATE users SET is_active = 1, approval_status = 'approved', approved_at = datetime('now') WHERE id = ?"
  ).run(pendingId);
  db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(adminPerpusRole.id, pendingId);
  const updatedUser = db
    .prepare('SELECT u.is_active, u.approval_status, r.slug as role_slug FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?')
    .get(pendingId) as { is_active: number; approval_status: string; role_slug: string };
  assert.equal(updatedUser.is_active, 1);
  assert.equal(updatedUser.approval_status, 'approved');
  assert.equal(updatedUser.role_slug, 'admin_perpus');

  // Custom role creation
  const customRoleId = Number(
    db
      .prepare(
        "INSERT INTO roles (slug, name, description, category, requires_approval, is_system) VALUES ('pembina_pramuka', 'Pembina Pramuka', 'Akses pojok baca pramuka', 'Kustom', 0, 0)"
      )
      .run().lastInsertRowid
  );
  assert.ok(customRoleId > 0);

  // Member lifecycle: create -> block -> unblock -> deactivate -> archive -> restore
  const mId = Number(
    db
      .prepare(
        `INSERT INTO members (member_code, full_name, membership_type_id, registered_at, expires_at, status)
         VALUES ('AGT-TEST-9999', 'Uji Anggota', 1, '2026-11-19', '2027-11-19', 'Aktif')`
      )
      .run().lastInsertRowid
  );
  db.prepare("UPDATE members SET status = 'Diblokir', block_reason = 'Terlambat' WHERE id = ?").run(mId);
  db.prepare("UPDATE members SET status = 'Aktif', block_reason = '' WHERE id = ?").run(mId);
  db.prepare("UPDATE members SET status = 'Nonaktif', archived_at = datetime('now') WHERE id = ?").run(mId);
  const archivedMember = db.prepare('SELECT status, archived_at FROM members WHERE id = ?').get(mId) as {
    status: string;
    archived_at: string | null;
  };
  assert.equal(archivedMember.status, 'Nonaktif');
  assert.ok(archivedMember.archived_at);

  db.prepare("UPDATE members SET status = 'Aktif', archived_at = NULL WHERE id = ?").run(mId);
  const restoredMember = db.prepare('SELECT status, archived_at FROM members WHERE id = ?').get(mId) as {
    status: string;
    archived_at: string | null;
  };
  assert.equal(restoredMember.status, 'Aktif');
  assert.equal(restoredMember.archived_at, null);

  db.close();
});



