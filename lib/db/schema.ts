import type Database from 'better-sqlite3';

export interface Migration {
  id: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        module TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS membership_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        max_loans INTEGER NOT NULL DEFAULT 3,
        loan_duration_days INTEGER NOT NULL DEFAULT 7,
        max_renewals INTEGER NOT NULL DEFAULT 1,
        daily_fine_rate INTEGER NOT NULL DEFAULT 1000,
        max_fine_cap INTEGER NOT NULL DEFAULT 50000,
        allow_reservation INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_code TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        photo_url TEXT NOT NULL DEFAULT '',
        membership_type_id INTEGER NOT NULL,
        identity_number TEXT NOT NULL DEFAULT '',
        gender TEXT NOT NULL DEFAULT 'Tidak Disebutkan',
        unit_or_class TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        registered_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Aktif',
        block_reason TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (membership_type_id) REFERENCES membership_types(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        member_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (role_id) REFERENCES roles(id),
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS authors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS publishers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        city TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL UNIQUE,
        parent_id INTEGER,
        FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        building TEXT NOT NULL,
        floor TEXT NOT NULL DEFAULT 'Lantai 1',
        room TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS shelves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 200,
        FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        isbn TEXT UNIQUE,
        edition TEXT NOT NULL DEFAULT 'Cetakan 1',
        publish_year INTEGER NOT NULL DEFAULT 2024,
        language TEXT NOT NULL DEFAULT 'Indonesia',
        description TEXT NOT NULL DEFAULT '',
        pages INTEGER NOT NULL DEFAULT 200,
        cover_url TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 100000,
        publisher_id INTEGER,
        category_id INTEGER,
        subcategory TEXT NOT NULL DEFAULT '',
        is_reference_only INTEGER NOT NULL DEFAULT 0,
        read_in_place_only INTEGER NOT NULL DEFAULT 0,
        acquisition_date TEXT NOT NULL DEFAULT (date('now')),
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS book_authors (
        book_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        PRIMARY KEY (book_id, author_id),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS book_categories (
        book_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        PRIMARY KEY (book_id, category_id),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS book_copies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        inventory_code TEXT NOT NULL UNIQUE,
        barcode TEXT NOT NULL UNIQUE,
        shelf_id INTEGER,
        condition TEXT NOT NULL DEFAULT 'Baik',
        status TEXT NOT NULL DEFAULT 'Tersedia',
        acquisition_date TEXT NOT NULL DEFAULT (date('now')),
        price INTEGER NOT NULL DEFAULT 100000,
        notes TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT,
        FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_number TEXT NOT NULL UNIQUE,
        idempotency_key TEXT UNIQUE,
        member_id INTEGER NOT NULL,
        staff_user_id INTEGER,
        loan_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Aktif',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
        FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS loan_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id INTEGER NOT NULL,
        copy_id INTEGER NOT NULL,
        due_date TEXT NOT NULL,
        returned_at TEXT,
        status TEXT NOT NULL DEFAULT 'Dipinjam',
        renewal_count INTEGER NOT NULL DEFAULT 0,
        return_condition TEXT,
        FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
        FOREIGN KEY (copy_id) REFERENCES book_copies(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS loan_renewals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_item_id INTEGER NOT NULL,
        renewed_by_user_id INTEGER,
        old_due_date TEXT NOT NULL,
        new_due_date TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        renewed_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (loan_item_id) REFERENCES loan_items(id) ON DELETE CASCADE,
        FOREIGN KEY (renewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_number TEXT NOT NULL UNIQUE,
        loan_id INTEGER NOT NULL,
        loan_item_id INTEGER NOT NULL,
        copy_id INTEGER NOT NULL,
        staff_user_id INTEGER,
        returned_at TEXT NOT NULL,
        condition TEXT NOT NULL DEFAULT 'Baik',
        status TEXT NOT NULL DEFAULT 'Tepat Waktu',
        overdue_days INTEGER NOT NULL DEFAULT 0,
        fine_amount INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE RESTRICT,
        FOREIGN KEY (loan_item_id) REFERENCES loan_items(id) ON DELETE RESTRICT,
        FOREIGN KEY (copy_id) REFERENCES book_copies(id) ON DELETE RESTRICT,
        FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservation_number TEXT NOT NULL UNIQUE,
        book_id INTEGER NOT NULL,
        copy_id INTEGER,
        member_id INTEGER NOT NULL,
        queue_position INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'Menunggu',
        reserved_at TEXT NOT NULL DEFAULT (datetime('now')),
        notified_at TEXT,
        expires_at TEXT,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY (copy_id) REFERENCES book_copies(id) ON DELETE SET NULL,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS fines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fine_number TEXT NOT NULL UNIQUE,
        member_id INTEGER NOT NULL,
        loan_id INTEGER,
        return_id INTEGER,
        fine_type TEXT NOT NULL DEFAULT 'Keterlambatan',
        amount INTEGER NOT NULL,
        paid_amount INTEGER NOT NULL DEFAULT 0,
        waived_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Belum Lunas',
        reason TEXT NOT NULL DEFAULT '',
        created_by_user_id INTEGER,
        waived_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
        FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE SET NULL,
        FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (waived_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_number TEXT NOT NULL UNIQUE,
        fine_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        method TEXT NOT NULL DEFAULT 'Tunai',
        received_by_user_id INTEGER,
        paid_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (fine_id) REFERENCES fines(id) ON DELETE RESTRICT,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
        FOREIGN KEY (received_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        contact_person TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS acquisitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_number TEXT NOT NULL UNIQUE,
        title_summary TEXT NOT NULL,
        supplier_id INTEGER,
        requested_by_user_id INTEGER,
        approved_by_user_id INTEGER,
        order_date TEXT,
        received_date TEXT,
        total_estimated_cost INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Diajukan',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
        FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS acquisition_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        acquisition_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        isbn TEXT NOT NULL DEFAULT '',
        author_name TEXT NOT NULL DEFAULT '',
        publisher_name TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        quantity_ordered INTEGER NOT NULL DEFAULT 1,
        quantity_received INTEGER NOT NULL DEFAULT 0,
        unit_price INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Menunggu',
        FOREIGN KEY (acquisition_id) REFERENCES acquisitions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS inventory_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_number TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        shelf_id INTEGER,
        conducted_by_user_id INTEGER,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'Berlangsung',
        total_expected INTEGER NOT NULL DEFAULT 0,
        total_scanned INTEGER NOT NULL DEFAULT 0,
        total_discrepancy INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (shelf_id) REFERENCES shelves(id) ON DELETE SET NULL,
        FOREIGN KEY (conducted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS inventory_audit_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        copy_id INTEGER NOT NULL,
        expected_status TEXT NOT NULL,
        physical_status TEXT NOT NULL DEFAULT 'Ditemukan',
        scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT NOT NULL DEFAULT '',
        UNIQUE (audit_id, copy_id),
        FOREIGN KEY (audit_id) REFERENCES inventory_audits(id) ON DELETE CASCADE,
        FOREIGN KEY (copy_id) REFERENCES book_copies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        member_id INTEGER,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS library_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_by_user_id INTEGER,
        FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT NOT NULL DEFAULT 'Sistem',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        before_json TEXT,
        after_json TEXT,
        ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
      CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
      CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_id);
      CREATE INDEX IF NOT EXISTS idx_copies_book ON book_copies(book_id);
      CREATE INDEX IF NOT EXISTS idx_copies_status ON book_copies(status);
      CREATE INDEX IF NOT EXISTS idx_copies_barcode ON book_copies(barcode);
      CREATE INDEX IF NOT EXISTS idx_members_code ON members(member_code);
      CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
      CREATE INDEX IF NOT EXISTS idx_loans_member ON loans(member_id);
      CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
      CREATE INDEX IF NOT EXISTS idx_loan_items_loan ON loan_items(loan_id);
      CREATE INDEX IF NOT EXISTS idx_loan_items_copy ON loan_items(copy_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_book ON reservations(book_id, status);
      CREATE INDEX IF NOT EXISTS idx_fines_member ON fines(member_id, status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, created_at);
    `,
  },
  {
    id: '002_reading_schedules',
    up: `
      CREATE TABLE IF NOT EXISTS reading_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_code TEXT NOT NULL UNIQUE,
        class_name TEXT NOT NULL,
        grade_level INTEGER NOT NULL,
        homeroom_teacher TEXT NOT NULL,
        student_count INTEGER NOT NULL DEFAULT 28,
        day_of_week TEXT NOT NULL,
        schedule_date TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        room_area TEXT NOT NULL,
        reading_mode TEXT NOT NULL DEFAULT 'Literasi Pagi',
        reading_theme TEXT NOT NULL DEFAULT '',
        book_id INTEGER,
        status TEXT NOT NULL DEFAULT 'Terjadwal',
        students_present INTEGER NOT NULL DEFAULT 0,
        books_read_count INTEGER NOT NULL DEFAULT 0,
        session_notes TEXT NOT NULL DEFAULT '',
        completed_at TEXT,
        archived_at TEXT,
        created_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS reading_schedule_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id INTEGER NOT NULL,
        session_date TEXT NOT NULL,
        status TEXT NOT NULL,
        students_present INTEGER NOT NULL DEFAULT 0,
        books_read_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        recorded_by_user_id INTEGER,
        recorded_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (schedule_id) REFERENCES reading_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reading_schedules_day ON reading_schedules(day_of_week, start_time);
      CREATE INDEX IF NOT EXISTS idx_reading_schedules_class ON reading_schedules(class_name, grade_level);
      CREATE INDEX IF NOT EXISTS idx_reading_schedule_logs_sched ON reading_schedule_logs(schedule_id, session_date);
    `,
  },
  {
    id: '003_class_rosters_and_attendance',
    up: `
      ALTER TABLE reading_schedules ADD COLUMN companion_teacher TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS school_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_name TEXT NOT NULL UNIQUE,
        grade_level INTEGER NOT NULL,
        homeroom_teacher TEXT NOT NULL,
        companion_teacher TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS class_students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_name TEXT NOT NULL,
        student_code TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT 'L',
        status TEXT NOT NULL DEFAULT 'Aktif',
        notes TEXT NOT NULL DEFAULT '',
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reading_session_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_id INTEGER NOT NULL,
        schedule_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        student_code TEXT NOT NULL,
        student_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Hadir',
        books_read INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(log_id, student_id),
        FOREIGN KEY (log_id) REFERENCES reading_schedule_logs(id) ON DELETE CASCADE,
        FOREIGN KEY (schedule_id) REFERENCES reading_schedules(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES class_students(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_name, archived_at);
      CREATE INDEX IF NOT EXISTS idx_reading_attendance_log ON reading_session_attendance(log_id);
      CREATE INDEX IF NOT EXISTS idx_reading_attendance_sched_student ON reading_session_attendance(schedule_id, student_id);
    `,
  },
  {
    id: '004_rich_book_metadata',
    up: `
      ALTER TABLE books ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN series_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN volume TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN illustrator TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN editor TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN translator TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN publish_city TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN ddc_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN call_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN subjects TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN target_grade TEXT NOT NULL DEFAULT 'Semua Kelas (1–6 SD)';
      ALTER TABLE books ADD COLUMN age_range TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN dimensions TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN binding_type TEXT NOT NULL DEFAULT 'Softcover (Art Carton)';
      ALTER TABLE books ADD COLUMN paper_type TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN weight_grams INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE books ADD COLUMN illustration_notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN table_of_contents TEXT NOT NULL DEFAULT '';
      ALTER TABLE books ADD COLUMN acquisition_source TEXT NOT NULL DEFAULT 'Pembelian Dana BOS';
      ALTER TABLE books ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_books_ddc ON books(ddc_code);
      CREATE INDEX IF NOT EXISTS idx_books_call_number ON books(call_number);
    `,
  },
  {
    id: '005_backup_snapshots_and_settings',
    up: `
      CREATE TABLE IF NOT EXISTS backup_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_code TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'full',
        modules_json TEXT NOT NULL DEFAULT '[]',
        checksum TEXT NOT NULL,
        total_records INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        table_counts_json TEXT NOT NULL DEFAULT '{}',
        payload_json TEXT NOT NULL,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT 'Super Admin',
        is_auto_safety INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created ON backup_snapshots(created_at DESC);

      INSERT OR IGNORE INTO library_settings (key, value) VALUES
        ('library_tagline', 'Menumbuhkan Budaya Baca Sejak Sekolah Dasar'),
        ('library_phone', '(021) 555-0192'),
        ('library_website', 'https://lenterapustaka.sch.id'),
        ('school_npsn', '20109842'),
        ('principal_name', 'Dra. Hj. Ratna Kusuma, M.Pd.'),
        ('librarian_head_name', 'Siti Rahmawati, S.IP.'),
        ('academic_year', '2026/2027'),
        ('semester', 'Ganjil'),
        ('lost_book_fee_percent', '100'),
        ('reservation_expiry_days', '3'),
        ('auto_reminder_days_before_due', '2'),
        ('allow_partial_fine_payment', 'true'),
        ('allow_overdue_renewal', 'false'),
        ('enable_opac_public', 'true'),
        ('backup_auto_frequency', 'weekly'),
        ('backup_retention_count', '10'),
        ('backup_include_audit_logs', 'false');
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((r) => r.id));

  for (const m of MIGRATIONS) {
    if (!applied.has(m.id)) {
      db.transaction(() => {
        db.exec(m.up);
        db.prepare('INSERT INTO migrations (id) VALUES (?)').run(m.id);
      })();
    }
  }
}
