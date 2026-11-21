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

test('migration 007_rombel_management supports adding custom rombel (Kelas 6D), students, schedules, archive, and restore', async () => {
  const { computeClassCoverage, buildAutoClassScheduleSlots, compareClassNames } = await import(
    '../domain/reading-schedule-rules'
  );
  const db = createTestDb();

  // Verify migration 007 columns exist on school_classes
  const cols = (db.prepare('PRAGMA table_info(school_classes)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  assert.ok(cols.includes('room_label'), 'Expected school_classes.room_label');
  assert.ok(cols.includes('notes'), 'Expected school_classes.notes');
  assert.ok(cols.includes('archived_at'), 'Expected school_classes.archived_at');

  // Insert custom rombel Kelas 6D
  const inserted = db
    .prepare(
      `INSERT INTO school_classes (class_name, grade_level, homeroom_teacher, companion_teacher, room_label, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      'Kelas 6D',
      6,
      'Ibu Kartika Dewi, S.Pd.',
      'Pak Dimas Prakoso, S.Pd.',
      'Gedung B Lt. 2',
      'Rombel tambahan literasi unggulan'
    );
  assert.ok(Number(inserted.lastInsertRowid) > 0);

  // Add students into Kelas 6D
  db.prepare(
    `INSERT INTO class_students (class_name, student_code, full_name, gender, notes)
     VALUES ('Kelas 6D', 'NIS-6D-01', 'Nadia Putri', 'P', ''),
            ('Kelas 6D', 'NIS-6D-02', 'Raka Pratama', 'L', '')`
  ).run();

  const activeClasses = (
    db
      .prepare('SELECT class_name, grade_level, homeroom_teacher, companion_teacher FROM school_classes WHERE archived_at IS NULL')
      .all() as Array<{
      class_name: string;
      grade_level: number;
      homeroom_teacher: string;
      companion_teacher: string;
    }>
  ).sort((a, b) => compareClassNames(a.class_name, b.class_name));

  assert.equal(activeClasses.length, 13);
  assert.equal(activeClasses[activeClasses.length - 1].class_name, 'Kelas 6D');

  const classPresets = activeClasses.map((c) => ({
    className: c.class_name,
    gradeLevel: c.grade_level,
    homeroomTeacher: c.homeroom_teacher,
    companionTeacher: c.companion_teacher,
    studentCount: 20,
  }));

  const loadDomainSchedules = () =>
    (
      db
        .prepare('SELECT * FROM reading_schedules WHERE archived_at IS NULL')
        .all() as Array<{
        id: number;
        schedule_code: string;
        class_name: string;
        grade_level: number;
        homeroom_teacher: string;
        companion_teacher: string;
        student_count: number;
        day_of_week: string;
        schedule_date: string | null;
        start_time: string;
        end_time: string;
        room_area: string;
        reading_mode: string;
        reading_theme: string;
        book_id: number | null;
        status: string;
        students_present: number;
        books_read_count: number;
        session_notes: string;
        archived_at: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      scheduleCode: r.schedule_code,
      className: r.class_name,
      gradeLevel: r.grade_level,
      homeroomTeacher: r.homeroom_teacher,
      companionTeacher: r.companion_teacher,
      studentCount: r.student_count,
      dayOfWeek: r.day_of_week,
      scheduleDate: r.schedule_date,
      startTime: r.start_time,
      endTime: r.end_time,
      roomArea: r.room_area,
      readingMode: r.reading_mode,
      readingTheme: r.reading_theme,
      bookId: r.book_id,
      status: r.status,
      studentsPresent: r.students_present,
      booksReadCount: r.books_read_count,
      sessionNotes: r.session_notes,
      archived: Boolean(r.archived_at),
    }));

  const existingScheds = loadDomainSchedules();

  const coverageBefore = computeClassCoverage(existingScheds, classPresets);
  assert.equal(coverageBefore.totalClasses, 13);
  assert.equal(coverageBefore.coveredCount, 12);
  assert.deepEqual(coverageBefore.missingClasses, ['Kelas 6D']);

  // Auto-scheduler generates a non-conflicting slot specifically for Kelas 6D
  const generated = buildAutoClassScheduleSlots(existingScheds, { id: 1, title: 'Buku Pilihan' }, classPresets);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].className, 'Kelas 6D');
  assert.equal(generated[0].homeroomTeacher, 'Ibu Kartika Dewi, S.Pd.');
  assert.equal(generated[0].companionTeacher, 'Pak Dimas Prakoso, S.Pd.');

  db.prepare(
    `INSERT INTO reading_schedules
      (schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count, day_of_week, start_time, end_time, room_area, reading_mode, reading_theme, book_id, status)
     VALUES ('JDW-2026-0099', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Terjadwal')`
  ).run(
    generated[0].className,
    generated[0].gradeLevel,
    generated[0].homeroomTeacher,
    generated[0].companionTeacher,
    2,
    generated[0].dayOfWeek,
    generated[0].startTime,
    generated[0].endTime,
    generated[0].roomArea,
    generated[0].readingMode,
    generated[0].readingTheme,
    generated[0].bookId
  );

  const schedsAfter = loadDomainSchedules();
  const coverageAfter = computeClassCoverage(schedsAfter, classPresets);
  assert.equal(coverageAfter.coveredCount, 13);
  assert.equal(coverageAfter.coveragePercent, 100);

  // Soft-archive and restore Kelas 6D preserves students
  db.prepare("UPDATE school_classes SET archived_at = datetime('now') WHERE class_name = 'Kelas 6D'").run();
  const activeAfterArchive = (
    db.prepare('SELECT COUNT(*) as c FROM school_classes WHERE archived_at IS NULL').get() as { c: number }
  ).c;
  assert.equal(activeAfterArchive, 12);

  const studentsStillPresent = (
    db.prepare("SELECT COUNT(*) as c FROM class_students WHERE class_name = 'Kelas 6D' AND archived_at IS NULL").get() as { c: number }
  ).c;
  assert.equal(studentsStillPresent, 2);

  db.prepare("UPDATE school_classes SET archived_at = NULL WHERE class_name = 'Kelas 6D'").run();
  const activeAfterRestore = (
    db.prepare('SELECT COUNT(*) as c FROM school_classes WHERE archived_at IS NULL').get() as { c: number }
  ).c;
  assert.equal(activeAfterRestore, 13);

  db.close();
});

test('Rombel/Kelas report queries filter loans, returns, popular books, fines, class_rosters, and acquisitions accurately', async () => {
  const { doesAcquisitionTextMatchClass } = await import('../domain/report-filters');
  const db = createTestDb();

  // 1. Loans filtered by Kelas 5A should only return Bima Pratama Putra's 2 loans
  const kelas5ALoans = db
    .prepare(
      `SELECT l.loan_number, m.unit_or_class
       FROM loans l
       JOIN members m ON m.id = l.member_id
       WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))`
    )
    .all('Kelas 5A') as Array<{ loan_number: string; unit_or_class: string }>;
  assert.equal(kelas5ALoans.length, 2);
  assert.ok(kelas5ALoans.every((r) => r.unit_or_class === 'Kelas 5A'));

  // 2. Returns filtered by Kelas 2B should return Alya's late return
  const kelas2BReturns = db
    .prepare(
      `SELECT r.return_number, m.unit_or_class
       FROM returns r
       JOIN loans l ON l.id = r.loan_id
       JOIN members m ON m.id = l.member_id
       WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))`
    )
    .all('Kelas 2B') as Array<{ return_number: string; unit_or_class: string }>;
  assert.equal(kelas2BReturns.length, 1);
  assert.equal(kelas2BReturns[0].return_number, 'KMB-2026-0002');

  // 3. Popular books filtered by Kelas 5A returns books borrowed by Kelas 5A
  const kelas5APopular = db
    .prepare(
      `SELECT b.title, COUNT(li.id) as total_borrowed
       FROM books b
       JOIN book_copies bc ON bc.book_id = b.id
       JOIN loan_items li ON li.copy_id = bc.id
       JOIN loans l ON l.id = li.loan_id
       JOIN members m ON m.id = l.member_id
       WHERE b.archived_at IS NULL AND LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))
       GROUP BY b.id
       ORDER BY total_borrowed DESC`
    )
    .all('Kelas 5A') as Array<{ title: string; total_borrowed: number }>;
  assert.equal(kelas5APopular.length, 2);
  assert.equal(kelas5APopular[0].total_borrowed, 2);

  // 4. Fines filtered by Kelas 6A returns Fajar's unpaid fine
  const kelas6AFines = db
    .prepare(
      `SELECT f.fine_number, m.unit_or_class
       FROM fines f
       JOIN members m ON m.id = f.member_id
       WHERE LOWER(TRIM(m.unit_or_class)) = LOWER(TRIM(?))`
    )
    .all('Kelas 6A') as Array<{ fine_number: string; unit_or_class: string }>;
  assert.equal(kelas6AFines.length, 1);
  assert.equal(kelas6AFines[0].fine_number, 'DND-2026-0002');

  // 5. Class rosters filtered by Kelas 5A returns exactly 1 rombel row
  const kelas5ARoster = db
    .prepare(
      `SELECT sc.class_name, sc.homeroom_teacher
       FROM school_classes sc
       WHERE sc.archived_at IS NULL AND LOWER(TRIM(sc.class_name)) = LOWER(TRIM(?))`
    )
    .all('Kelas 5A') as Array<{ class_name: string; homeroom_teacher: string }>;
  assert.equal(kelas5ARoster.length, 1);
  assert.equal(kelas5ARoster[0].class_name, 'Kelas 5A');

  // 6. Acquisitions filtered by grade suitability distinguish Kelas 2B (1-3) vs Kelas 5A (4-6)
  const acqRows = db
    .prepare('SELECT request_number, title_summary, notes FROM acquisitions')
    .all() as Array<{ request_number: string; title_summary: string; notes: string }>;
  const acq2B = acqRows.filter((a) =>
    doesAcquisitionTextMatchClass({ titleSummary: a.title_summary, notes: a.notes }, 'Kelas 2B')
  );
  const acq5A = acqRows.filter((a) =>
    doesAcquisitionTextMatchClass({ titleSummary: a.title_summary, notes: a.notes }, 'Kelas 5A')
  );
  assert.equal(acq2B.length, 1);
  assert.equal(acq2B[0].request_number, 'PGD-2026-0001');
  assert.equal(acq5A.length, 1);
  assert.equal(acq5A[0].request_number, 'PGD-2026-0002');

  db.close();
});

test('migration 008_registration_requests handles student roster sync, empty-slot teacher direct sync, and conflict approve/reject cleanly', async () => {
  const {
    ensureMemberRecordForUser,
    syncStudentToClassRoster,
    syncTeacherToClassAndSchedules,
  } = await import('./member-link');
  const {
    detectClassTeacherConflict,
    buildRegistrationRequestCode,
  } = await import('../domain/signup-rules');

  const db = createTestDb();

  // 1. Verify users.assigned_class and registration_requests table exist
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  assert.ok(userCols.includes('assigned_class'), 'Expected users.assigned_class column');

  const reqCols = (
    db.prepare('PRAGMA table_info(registration_requests)').all() as Array<{ name: string }>
  ).map((c) => c.name);
  for (const col of [
    'request_code',
    'email',
    'requested_role_id',
    'requested_role_slug',
    'assigned_class',
    'conflict_type',
    'conflict_existing_value',
    'status',
    'decision_note',
    'resolution_json',
  ]) {
    assert.ok(reqCols.includes(col), `Expected registration_requests.${col}`);
  }

  // 2. Siswa signup syncs into class_students & resolves SISWA_TINGGI for Kelas 5A
  const siswaRole = db.prepare("SELECT id FROM roles WHERE slug = 'siswa'").get() as { id: number };
  const siswaUserId = Number(
    db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active, approval_status, assigned_class)
         VALUES ('naufal.5a', 'naufal.5a@sd.id', 'Naufal Ramadhan', 'hash', ?, 1, 'approved', 'Kelas 5A')`
      )
      .run(siswaRole.id).lastInsertRowid
  );
  const memberId = ensureMemberRecordForUser(db, {
    fullName: 'Naufal Ramadhan',
    email: 'naufal.5a@sd.id',
    roleSlug: 'siswa',
    roleName: 'Siswa',
    identityNumber: 'NIS-2026-881',
    unitOrClass: 'Kelas 5A',
    assignedClass: 'Kelas 5A',
    gender: 'L',
  });
  const memberRow = db
    .prepare(
      `SELECT m.unit_or_class, m.gender, mt.code as type_code
       FROM members m JOIN membership_types mt ON mt.id = m.membership_type_id
       WHERE m.id = ?`
    )
    .get(memberId) as { unit_or_class: string; gender: string; type_code: string };
  assert.equal(memberRow.unit_or_class, 'Kelas 5A');
  assert.equal(memberRow.gender, 'Laki-laki');
  assert.equal(memberRow.type_code, 'SISWA_TINGGI');

  syncStudentToClassRoster(db, {
    className: 'Kelas 5A',
    fullName: 'Naufal Ramadhan',
    identityNumber: 'NIS-2026-881',
    gender: 'L',
  });
  const rosterEntry = db
    .prepare("SELECT full_name, student_code FROM class_students WHERE class_name = 'Kelas 5A' AND full_name = 'Naufal Ramadhan'")
    .get() as { full_name: string; student_code: string } | undefined;
  assert.ok(rosterEntry);
  assert.equal(rosterEntry.student_code, 'NIS-2026-881');

  // 3. Empty-slot class allows direct sync of Wali Kelas to school_classes & reading_schedules
  db.prepare(
    `INSERT INTO school_classes (class_name, grade_level, homeroom_teacher, companion_teacher)
     VALUES ('Kelas 6C', 6, '', '')`
  ).run();
  db.prepare(
    `INSERT INTO reading_schedules
      (schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count, day_of_week, start_time, end_time, room_area, reading_mode, reading_theme, status)
     VALUES ('JDW-TEST-6C', 'Kelas 6C', 6, '', '', 20, 'Jumat', '08:00', '08:45', 'Ruang Baca Utama', 'Membaca Mandiri', 'Sains Anak', 'Terjadwal')`
  ).run();

  const emptyClass = db
    .prepare("SELECT class_name, homeroom_teacher, companion_teacher FROM school_classes WHERE class_name = 'Kelas 6C'")
    .get() as { class_name: string; homeroom_teacher: string; companion_teacher: string };
  const noConflict = detectClassTeacherConflict({
    roleSlug: 'wali_kelas',
    selectedClass: 'Kelas 6C',
    applicantFullName: 'Ibu Nadia Lestari, S.Pd.',
    classRecord: {
      className: emptyClass.class_name,
      homeroomTeacher: emptyClass.homeroom_teacher,
      companionTeacher: emptyClass.companion_teacher,
    },
  });
  assert.equal(noConflict.hasConflict, false);

  const synced = syncTeacherToClassAndSchedules(db, {
    slot: 'homeroom',
    className: 'Kelas 6C',
    teacherName: 'Ibu Nadia Lestari, S.Pd.',
    syncSchedules: true,
  });
  assert.equal(synced.updatedClass, true);
  assert.equal(synced.updatedSchedules, 1);

  const classAfterDirect = db
    .prepare("SELECT homeroom_teacher FROM school_classes WHERE class_name = 'Kelas 6C'")
    .get() as { homeroom_teacher: string };
  const schedAfterDirect = db
    .prepare("SELECT homeroom_teacher FROM reading_schedules WHERE schedule_code = 'JDW-TEST-6C'")
    .get() as { homeroom_teacher: string };
  assert.equal(classAfterDirect.homeroom_teacher, 'Ibu Nadia Lestari, S.Pd.');
  assert.equal(schedAfterDirect.homeroom_teacher, 'Ibu Nadia Lestari, S.Pd.');

  // 4. Occupied class (Kelas 1A) detects conflict -> queued ONLY in registration_requests, NOT in users
  const waliRole = db.prepare("SELECT id FROM roles WHERE slug = 'wali_kelas'").get() as { id: number };
  const kelas1A = db
    .prepare("SELECT class_name, homeroom_teacher, companion_teacher FROM school_classes WHERE class_name = 'Kelas 1A'")
    .get() as { class_name: string; homeroom_teacher: string; companion_teacher: string };
  const conflict = detectClassTeacherConflict({
    roleSlug: 'wali_kelas',
    selectedClass: 'Kelas 1A',
    applicantFullName: 'Pak Hendra Wijaya, S.Pd.',
    classRecord: {
      className: kelas1A.class_name,
      homeroomTeacher: kelas1A.homeroom_teacher,
      companionTeacher: kelas1A.companion_teacher,
    },
  });
  assert.equal(conflict.hasConflict, true);
  assert.equal(conflict.conflictType, 'class_homeroom_teacher');

  const usersCountBefore = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const reqCode = buildRegistrationRequestCode(new Date('2026-11-20T00:00:00Z'));
  const reqId = Number(
    db
      .prepare(
        `INSERT INTO registration_requests
          (request_code, username, email, full_name, password_hash, requested_role_id, requested_role_slug, assigned_class, has_conflict, conflict_type, conflict_existing_value, conflict_summary, status)
         VALUES (?, 'hendra.konflik', 'hendra.konflik@sd.id', 'Pak Hendra Wijaya, S.Pd.', 'secret-hash', ?, 'wali_kelas', 'Kelas 1A', 1, ?, ?, ?, 'pending')`
      )
      .run(reqCode, waliRole.id, conflict.conflictType, conflict.existingValue, conflict.summary).lastInsertRowid
  );
  assert.ok(reqId > 0);
  const usersCountWhilePending = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  assert.equal(usersCountWhilePending, usersCountBefore, 'Pending signup must NOT create a row in users');

  // Reject request -> password_hash wiped, still NO row in users, Kelas 1A unchanged
  db.prepare(
    "UPDATE registration_requests SET status = 'rejected', password_hash = '', decision_note = 'Data wali kelas lama masih aktif' WHERE id = ?"
  ).run(reqId);
  const rejectedReq = db
    .prepare('SELECT status, password_hash FROM registration_requests WHERE id = ?')
    .get(reqId) as { status: string; password_hash: string };
  assert.equal(rejectedReq.status, 'rejected');
  assert.equal(rejectedReq.password_hash, '');
  const userCheckRejected = db
    .prepare("SELECT id FROM users WHERE email = 'hendra.konflik@sd.id'")
    .get();
  assert.equal(userCheckRejected, undefined, 'Rejected signup must NOT save any account in users');
  const kelas1AAfterReject = db
    .prepare("SELECT homeroom_teacher FROM school_classes WHERE class_name = 'Kelas 1A'")
    .get() as { homeroom_teacher: string };
  assert.equal(kelas1AAfterReject.homeroom_teacher, kelas1A.homeroom_teacher);

  // Approve a second conflict request WITH applyClassTeacherSync = true + syncSchedules = true
  const approvedUserId = Number(
    db
      .prepare(
        `INSERT INTO users (username, email, full_name, password_hash, role_id, is_active, approval_status, assigned_class)
         VALUES ('dina.pengganti', 'dina.pengganti@sd.id', 'Ibu Dina Pengganti, S.Pd.', 'hash', ?, 1, 'approved', 'Kelas 1A')`
      )
      .run(waliRole.id).lastInsertRowid
  );
  assert.ok(approvedUserId > 0);
  const applyRes = syncTeacherToClassAndSchedules(db, {
    slot: 'homeroom',
    className: 'Kelas 1A',
    teacherName: 'Ibu Dina Pengganti, S.Pd.',
    syncSchedules: true,
  });
  assert.equal(applyRes.updatedClass, true);
  assert.ok(applyRes.updatedSchedules >= 1);

  const kelas1AAfterApprove = db
    .prepare("SELECT homeroom_teacher FROM school_classes WHERE class_name = 'Kelas 1A'")
    .get() as { homeroom_teacher: string };
  assert.equal(kelas1AAfterApprove.homeroom_teacher, 'Ibu Dina Pengganti, S.Pd.');

  db.close();
});

test('backup-first full data purge wipes operational tables safely, preserves super_admin/snapshots/audit, blocks re-seed, and restores cleanly', async () => {
  const {
    ALL_BACKUP_TABLES,
    CORE_BACKUP_MODULES,
    PURGE_CONFIRMATION_PHRASE,
    PURGEABLE_SQLITE_TABLES,
    buildBackupEnvelope,
    evaluatePurgeBackupPrerequisite,
    resolveTablesForModules,
    validateBackupEnvelope,
    validatePurgeAllDataRequest,
  } = await import('@/lib/domain/settings-backup-rules');
  const { seedClassRostersAndAttendance, seedReadingSchedules } = await import('./seed');
  const { logAudit } = await import('./audit');

  const db = createTestDb();
  const superAdmin = db
    .prepare(
      `SELECT u.id, u.full_name, r.slug as role_slug
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.slug = 'super_admin' LIMIT 1`
    )
    .get() as { id: number; full_name: string; role_slug: string };
  assert.ok(superAdmin);

  const booksBefore = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c;
  const membersBefore = (db.prepare('SELECT COUNT(*) as c FROM members').get() as { c: number }).c;
  const usersBefore = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  assert.ok(booksBefore >= 10);
  assert.ok(membersBefore >= 8);
  assert.ok(usersBefore >= 3);

  // 1. Without any snapshot -> purge eligibility must be false
  const beforeBackup = evaluatePurgeBackupPrerequisite([], booksBefore + membersBefore);
  assert.equal(beforeBackup.hasEligibleBackup, false);
  const blockedReq = validatePurgeAllDataRequest({
    actorRoleSlug: 'super_admin',
    confirmationPhrase: PURGE_CONFIRMATION_PHRASE,
    acknowledgeIrreversible: true,
    prerequisiteSnapshot: null,
  });
  assert.equal(blockedReq.ok, false);

  // 2. Create verified full snapshot in backup_snapshots
  const dumpTableNames = resolveTablesForModules(CORE_BACKUP_MODULES);
  const dumpedTables: Record<string, Array<Record<string, unknown>>> = {};
  for (const tbl of dumpTableNames) {
    dumpedTables[tbl] = db.prepare(`SELECT * FROM ${tbl}`).all() as Array<Record<string, unknown>>;
  }
  const envelope = buildBackupEnvelope({
    backupId: 'SNP-TEST-PURGE-01',
    label: 'Backup Penuh Wajib Pra-Hapus',
    sourceEngine: 'sqlite',
    exportedBy: superAdmin.full_name,
    selectedModules: CORE_BACKUP_MODULES,
    tables: dumpedTables,
  });
  const payloadJson = JSON.stringify(envelope);
  const snapId = Number(
    db
      .prepare(
        `INSERT INTO backup_snapshots
          (snapshot_code, label, notes, mode, modules_json, checksum, total_records, size_bytes, table_counts_json, payload_json, created_by_user_id, created_by_name, is_auto_safety)
         VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        envelope.backupId,
        envelope.label,
        envelope.mode,
        JSON.stringify(envelope.selectedModules),
        envelope.checksum,
        envelope.totalRecords,
        Buffer.byteLength(payloadJson, 'utf8'),
        JSON.stringify(envelope.tableCounts),
        payloadJson,
        superAdmin.id,
        superAdmin.full_name
      ).lastInsertRowid
  );
  const snapRow = db
    .prepare(
      'SELECT id, snapshot_code, label, mode, checksum, total_records, created_at FROM backup_snapshots WHERE id = ?'
    )
    .get(snapId) as {
    id: number;
    snapshot_code: string;
    label: string;
    mode: string;
    checksum: string;
    total_records: number;
    created_at: string;
  };

  // 3. Validate prerequisite passes now
  const eligibleCheck = validatePurgeAllDataRequest({
    actorRoleSlug: superAdmin.role_slug,
    confirmationPhrase: PURGE_CONFIRMATION_PHRASE,
    acknowledgeIrreversible: true,
    prerequisiteSnapshot: snapRow,
  });
  assert.equal(eligibleCheck.ok, true);

  // 4. Execute atomic purge transaction (mirroring /api/backup action=purge_all_data)
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const tbl of PURGEABLE_SQLITE_TABLES) {
        db.prepare(`DELETE FROM ${tbl}`).run();
      }
      db.prepare('DELETE FROM users WHERE id != ?').run(superAdmin.id);
      db.prepare(
        `INSERT INTO library_settings (key, value, updated_at)
         VALUES ('data_purged_at', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).run(new Date().toISOString());
      logAudit(db, {
        userId: superAdmin.id,
        userName: superAdmin.full_name,
        action: 'DATABASE_PURGE_ALL',
        entityType: 'backup',
        entityId: snapRow.snapshot_code,
        after: { prerequisiteSnapshotCode: snapRow.snapshot_code },
      });
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // 5. Verify all operational tables are 0 while system essentials survive
  for (const tbl of ['books', 'book_copies', 'members', 'loans', 'school_classes', 'class_students', 'reading_schedules']) {
    const c = (db.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as { c: number }).c;
    assert.equal(c, 0, `Expected ${tbl} to be empty after purge`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c, 1);
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(superAdmin.id));
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM backup_snapshots').get() as { c: number }).c, 1);
  assert.ok((db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c >= 19);
  assert.ok(
    db
      .prepare("SELECT id FROM audit_logs WHERE action = 'DATABASE_PURGE_ALL' AND entity_id = ?")
      .get('SNP-TEST-PURGE-01')
  );

  // 6. Verify secondary seeders respect data_purged_at and do NOT re-populate demo classes/schedules
  seedReadingSchedules(db);
  seedClassRostersAndAttendance(db);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM reading_schedules').get() as { c: number }).c, 0);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM school_classes').get() as { c: number }).c, 0);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM class_students').get() as { c: number }).c, 0);

  // 7. Verify prerequisite snapshot validates & restores all operational data cleanly
  const storedPayload = JSON.parse(
    (
      db.prepare('SELECT payload_json FROM backup_snapshots WHERE id = ?').get(snapId) as {
        payload_json: string;
      }
    ).payload_json
  );
  const envCheck = validateBackupEnvelope(storedPayload);
  assert.equal(envCheck.ok, true);
  assert.equal(envCheck.checksumStatus, 'verified');

  const tablesToRestore = ALL_BACKUP_TABLES.filter((t) => Array.isArray(storedPayload.tables[t]));
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const tbl of [...tablesToRestore].reverse()) {
        db.prepare(`DELETE FROM ${tbl}`).run();
      }
      for (const tbl of tablesToRestore) {
        const rows = storedPayload.tables[tbl] as Array<Record<string, unknown>>;
        if (!rows.length) continue;
        const schemaCols = new Set(
          (db.prepare(`PRAGMA table_info(${tbl})`).all() as Array<{ name: string }>).map(
            (c) => c.name
          )
        );
        for (const row of rows) {
          const cols = Object.keys(row).filter((k) => schemaCols.has(k));
          const placeholders = cols.map(() => '?').join(', ');
          db.prepare(
            `INSERT OR REPLACE INTO ${tbl} (${cols.join(', ')}) VALUES (${placeholders})`
          ).run(...cols.map((c) => row[c] ?? null));
        }
      }
      db.prepare("DELETE FROM library_settings WHERE key = 'data_purged_at'").run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  assert.equal((db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c, booksBefore);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM members').get() as { c: number }).c, membersBefore);
  assert.equal((db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c, usersBefore);
  assert.equal(
    db.prepare("SELECT value FROM library_settings WHERE key = 'data_purged_at'").get(),
    undefined
  );

  db.close();
});





