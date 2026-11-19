import type Database from 'better-sqlite3';
import { hashPassword } from '@/lib/auth/crypto';
import {
  SD_CLASSES,
  buildSeedStudentsForClass,
  getClassPreset,
} from '@/lib/domain/reading-schedule-rules';

export function seedDatabase(db: Database.Database): void {
  const roleCount = (db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c;
  if (roleCount > 0) return;

  db.transaction(() => {
    // 1. Roles
    const insertRole = db.prepare(
      'INSERT INTO roles (slug, name, description) VALUES (?, ?, ?)'
    );
    const superAdminId = Number(
      insertRole.run(
        'super_admin',
        'Super Admin',
        'Akses penuh seluruh sistem perpustakaan sekolah, manajemen akun, peran, konfigurasi, dan backup.'
      ).lastInsertRowid
    );
    const kepalaId = Number(
      insertRole.run(
        'kepala_perpustakaan',
        'Kepala Perpustakaan',
        'Mengelola koleksi SD, anggota sekolah, menyetujui pengadaan buku, melihat laporan literasi, dan memantau aktivitas.'
      ).lastInsertRowid
    );
    const pustakawanId = Number(
      insertRole.run(
        'pustakawan',
        'Pustakawan / Petugas',
        'Mengelola buku, data siswa/guru, peminjaman, pengembalian, reservasi, denda, dan inventaris rak.'
      ).lastInsertRowid
    );
    const anggotaId = Number(
      insertRole.run(
        'anggota',
        'Siswa / Guru',
        'Mengakses katalog OPAC sekolah, riwayat pinjaman pribadi, status denda, reservasi, dan perpanjangan.'
      ).lastInsertRowid
    );
    insertRole.run(
      'pengunjung',
      'Pengunjung',
      'Melihat katalog publik OPAC perpustakaan SD dan informasi ketersediaan buku.'
    );

    // 2. Permissions
    const permDefs: Array<[string, string, string]> = [
      ['dashboard.view', 'Lihat Dashboard Operasional', 'dashboard'],
      ['books.read', 'Lihat Data Buku & Eksemplar', 'books'],
      ['books.write', 'Tambah & Edit Buku/Eksemplar', 'books'],
      ['books.archive', 'Arsipkan Buku/Eksemplar', 'books'],
      ['books.import_export', 'Import & Export Koleksi', 'books'],
      ['members.read', 'Lihat Data Anggota', 'members'],
      ['members.write', 'Registrasi & Edit Anggota', 'members'],
      ['members.block', 'Blokir & Nonaktifkan Anggota', 'members'],
      ['loans.read', 'Lihat Transaksi Peminjaman', 'circulation'],
      ['loans.write', 'Proses Peminjaman & Perpanjangan', 'circulation'],
      ['returns.write', 'Proses Pengembalian Buku', 'circulation'],
      ['reservations.read', 'Lihat Antrean Reservasi', 'reservations'],
      ['reservations.write', 'Ajukan & Kelola Reservasi', 'reservations'],
      ['fines.read', 'Lihat Daftar Denda', 'fines'],
      ['fines.pay', 'Proses Pembayaran Denda', 'fines'],
      ['fines.waive', 'Pengecualian / Penghapusan Denda', 'fines'],
      ['inventory.read', 'Lihat Lokasi Rak & Inventaris', 'inventory'],
      ['inventory.write', 'Kelola Rak & Stock Opname', 'inventory'],
      ['acquisitions.read', 'Lihat Data Pengadaan', 'acquisitions'],
      ['acquisitions.write', 'Ajukan & Terima Pengadaan', 'acquisitions'],
      ['acquisitions.approve', 'Setujui / Tolak Pengadaan', 'acquisitions'],
      ['reports.read', 'Lihat & Export Laporan Analitik', 'reports'],
      ['notifications.read', 'Lihat Notifikasi', 'notifications'],
      ['settings.read', 'Lihat Pengaturan Sistem', 'settings'],
      ['settings.write', 'Ubah Pengaturan, RBAC & Backup', 'settings'],
      ['audit.read', 'Lihat Audit Log Aktivitas', 'audit'],
      ['schedules.read', 'Lihat Jadwal Baca Kelas', 'schedules'],
      ['schedules.write', 'Kelola Jadwal & Catat Sesi Baca', 'schedules'],
    ];

    const insertPerm = db.prepare(
      'INSERT INTO permissions (code, name, module) VALUES (?, ?, ?)'
    );
    const permMap = new Map<string, number>();
    for (const [code, name, mod] of permDefs) {
      const pid = Number(insertPerm.run(code, name, mod).lastInsertRowid);
      permMap.set(code, pid);
    }

    const assignPerm = db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    );

    // Super Admin -> all
    for (const pid of permMap.values()) {
      assignPerm.run(superAdminId, pid);
    }

    // Kepala Perpustakaan -> almost all except settings.write (RBAC/backup)
    for (const [code, pid] of permMap.entries()) {
      if (code !== 'settings.write') {
        assignPerm.run(kepalaId, pid);
      }
    }

    // Pustakawan
    const pustakawanCodes = [
      'dashboard.view',
      'books.read',
      'books.write',
      'books.import_export',
      'members.read',
      'members.write',
      'members.block',
      'loans.read',
      'loans.write',
      'returns.write',
      'reservations.read',
      'reservations.write',
      'fines.read',
      'fines.pay',
      'inventory.read',
      'inventory.write',
      'acquisitions.read',
      'acquisitions.write',
      'reports.read',
      'notifications.read',
      'schedules.read',
      'schedules.write',
    ];
    for (const code of pustakawanCodes) {
      const pid = permMap.get(code);
      if (pid) assignPerm.run(pustakawanId, pid);
    }

    // Anggota (Siswa / Guru)
    const anggotaCodes = [
      'books.read',
      'loans.read',
      'reservations.read',
      'reservations.write',
      'fines.read',
      'notifications.read',
      'schedules.read',
    ];
    for (const code of anggotaCodes) {
      const pid = permMap.get(code);
      if (pid) assignPerm.run(anggotaId, pid);
    }

    // 3. Membership Types (Sekolah Dasar)
    const insertMType = db.prepare(`
      INSERT INTO membership_types (code, name, max_loans, loan_duration_days, max_renewals, daily_fine_rate, max_fine_cap, allow_reservation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const typeSiswaRendah = Number(
      insertMType.run('SISWA_RENDAH', 'Siswa Kelas 1–3', 2, 7, 1, 500, 10000, 1).lastInsertRowid
    );
    const typeSiswaTinggi = Number(
      insertMType.run('SISWA_TINGGI', 'Siswa Kelas 4–6', 3, 7, 1, 500, 15000, 1).lastInsertRowid
    );
    const typeGuru = Number(
      insertMType.run('GURU', 'Guru & Wali Kelas', 6, 14, 2, 500, 20000, 1).lastInsertRowid
    );
    const typeStaf = Number(
      insertMType.run('STAF', 'Staf & Tata Usaha', 4, 14, 2, 500, 20000, 1).lastInsertRowid
    );
    const typeKomite = Number(
      insertMType.run('KOMITE', 'Orang Tua / Komite Sekolah', 2, 7, 1, 1000, 25000, 1).lastInsertRowid
    );

    // 4. Members (Siswa, Guru, Staf, Komite SD)
    const insertMember = db.prepare(`
      INSERT INTO members (member_code, full_name, membership_type_id, identity_number, gender, unit_or_class, address, phone, email, registered_at, expires_at, status, block_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const m1 = Number(
      insertMember.run(
        'AGT-2026-0001',
        'Bima Pratama Putra',
        typeSiswaTinggi,
        '0154829101',
        'Laki-laki',
        'Kelas 5A',
        'Jl. Melati No. 14, Kec. Coblong, Bandung',
        '081234567801',
        'anggota@lenterapustaka.id',
        '2026-07-14',
        '2027-07-14',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m2 = Number(
      insertMember.run(
        'AGT-2026-0002',
        'Ibu Nadia Kusuma, S.Pd.',
        typeGuru,
        '198808242014022001',
        'Perempuan',
        'Wali Kelas 4A',
        'Jl. Dago Asri No. 22, Bandung',
        '081234567802',
        'nadia.kusuma@lenterapustaka.id',
        '2026-07-14',
        '2027-07-14',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m3 = Number(
      insertMember.run(
        'AGT-2026-0003',
        'Alya Putri Azzahra',
        typeSiswaRendah,
        '0173920412',
        'Perempuan',
        'Kelas 2B',
        'Jl. Riau No. 88, Bandung',
        '081234567803',
        'ortu.alya@mail.id',
        '2026-07-15',
        '2027-07-15',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m4 = Number(
      insertMember.run(
        'AGT-2026-0004',
        'Siti Rahmawati',
        typeSiswaTinggi,
        '0149928173',
        'Perempuan',
        'Kelas 6B',
        'Jl. Cihampelas No. 51, Bandung',
        '081234567804',
        'siti.rahma@mail.id',
        '2026-07-15',
        '2027-07-15',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m5 = Number(
      insertMember.run(
        'AGT-2026-0005',
        'Pak Hendra Gunawan, S.Pd.',
        typeGuru,
        '198205022010011008',
        'Laki-laki',
        'Guru IPA & Sains SD',
        'Jl. Setiabudi No. 102, Bandung',
        '081234567805',
        'hendra.g@mail.id',
        '2026-07-16',
        '2027-07-16',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m6 = Number(
      insertMember.run(
        'AGT-2026-0006',
        'Dewi Anggraini',
        typeStaf,
        '199007512018032004',
        'Perempuan',
        'Tata Usaha Sekolah',
        'Jl. Dipatiukur No. 9, Bandung',
        '081234567806',
        'dewi.anggraini@lenterapustaka.id',
        '2025-11-25',
        '2026-11-25',
        'Aktif',
        ''
      ).lastInsertRowid
    );
    const m7 = Number(
      insertMember.run(
        'AGT-2026-0007',
        'Fajar Nugroho',
        typeSiswaTinggi,
        '0148810293',
        'Laki-laki',
        'Kelas 6A',
        'Jl. Sukajadi No. 33, Bandung',
        '081234567807',
        'ortu.fajar@mail.id',
        '2026-07-20',
        '2027-07-20',
        'Diblokir',
        'Menunggak pengembalian buku cerita lebih dari 14 hari'
      ).lastInsertRowid
    );
    Number(
      insertMember.run(
        'AGT-2026-0008',
        'Tari Melati (Komite)',
        typeKomite,
        '3273084412890008',
        'Perempuan',
        'Komite Kelas 3A',
        'Jl. Tubagus Ismail No. 7, Bandung',
        '081234567808',
        'tari.melati@mail.id',
        '2025-10-01',
        '2026-10-01',
        'Nonaktif',
        ''
      ).lastInsertRowid
    );

    // 5. Users (preserve login demo credentials for RBAC testing)
    const insertUser = db.prepare(`
      INSERT INTO users (username, email, full_name, password_hash, role_id, member_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const uAdmin = Number(
      insertUser.run(
        'superadmin',
        'admin@lenterapustaka.id',
        'Arif Rahman (Operator Sekolah)',
        hashPassword('admin123'),
        superAdminId,
        null
      ).lastInsertRowid
    );
    const uKepala = Number(
      insertUser.run(
        'kepala',
        'kepala@lenterapustaka.id',
        'Ibu Ratna Sari, S.Pd.',
        hashPassword('kepala123'),
        kepalaId,
        null
      ).lastInsertRowid
    );
    const uPustakawan = Number(
      insertUser.run(
        'pustakawan',
        'pustakawan@lenterapustaka.id',
        'Pak Dimas Prasetyo, S.I.Pust.',
        hashPassword('pustaka123'),
        pustakawanId,
        null
      ).lastInsertRowid
    );
    const uAnggota = Number(
      insertUser.run(
        'bima.putra',
        'anggota@lenterapustaka.id',
        'Bima Pratama Putra (Kelas 5A)',
        hashPassword('anggota123'),
        anggotaId,
        m1
      ).lastInsertRowid
    );

    // 6. Locations & Shelves (Ruang Perpustakaan Sekolah Dasar)
    const insertLoc = db.prepare(
      'INSERT INTO locations (code, building, floor, room, description) VALUES (?, ?, ?, ?, ?)'
    );
    const locUtama1 = Number(
      insertLoc.run(
        'GD-SD1',
        'Gedung Perpustakaan SD',
        'Lantai 1',
        'Pojok Baca & Koleksi Utama',
        'Area baca karpet warna-warni, buku cerita bergambar, dan buku paket tematik'
      ).lastInsertRowid
    );
    const locUtama2 = Number(
      insertLoc.run(
        'GD-SD2',
        'Gedung Perpustakaan SD',
        'Lantai 1',
        'Sudut Sains & Budaya Nusantara',
        'Rak buku eksperimen sains anak, sejarah pahlawan, dan cerita rakyat'
      ).lastInsertRowid
    );
    const locRef = Number(
      insertLoc.run(
        'GD-REF',
        'Gedung Perpustakaan SD',
        'Lantai 1',
        'Meja Referensi & Kamus Bergambar',
        'Koleksi ensiklopedia anak dan kamus khusus baca di tempat'
      ).lastInsertRowid
    );

    const insertShelf = db.prepare(
      'INSERT INTO shelves (location_id, code, name, capacity) VALUES (?, ?, ?, ?)'
    );
    const shelfCerita = Number(
      insertShelf.run(locUtama1, 'R-CRT-01', 'Rak Cerita Anak & Fabel', 180).lastInsertRowid
    );
    const shelfPelajaran = Number(
      insertShelf.run(locUtama1, 'R-PKT-01', 'Rak Buku Pelajaran & Tematik SD', 200).lastInsertRowid
    );
    const shelfSains = Number(
      insertShelf.run(locUtama2, 'R-SAI-01', 'Rak Sains & Eksperimen Cilik', 150).lastInsertRowid
    );
    const shelfBudaya = Number(
      insertShelf.run(locUtama2, 'R-BDY-01', 'Rak Budaya, Sejarah & Budi Pekerti', 150).lastInsertRowid
    );
    const shelfRef = Number(
      insertShelf.run(locRef, 'R-REF-01', 'Rak Ensiklopedia & Kamus SD', 100).lastInsertRowid
    );

    // 7. Categories, Publishers, Authors
    const insertCat = db.prepare('INSERT INTO categories (code, name) VALUES (?, ?)');
    const catCerita = Number(insertCat.run('808', 'Cerita Anak & Dongeng').lastInsertRowid);
    const catPelajaran = Number(insertCat.run('372', 'Buku Pelajaran & Tematik').lastInsertRowid);
    const catSains = Number(insertCat.run('500', 'Sains & Eksperimen Anak').lastInsertRowid);
    const catBudaya = Number(insertCat.run('959', 'Sejarah & Budaya Indonesia').lastInsertRowid);
    const catKarakter = Number(insertCat.run('170', 'Budi Pekerti & Karakter').lastInsertRowid);
    const catKesenian = Number(insertCat.run('700', 'Keterampilan & Kesenian').lastInsertRowid);

    const insertPub = db.prepare('INSERT INTO publishers (name, city) VALUES (?, ?)');
    const pubErlangga = Number(insertPub.run('Erlangga for Kids', 'Jakarta').lastInsertRowid);
    const pubKemendikbud = Number(insertPub.run('Kemendikbudristek', 'Jakarta').lastInsertRowid);
    const pubBip = Number(insertPub.run('Bhuana Ilmu Populer', 'Jakarta').lastInsertRowid);
    const pubMizan = Number(insertPub.run('Mizan Pelangi', 'Bandung').lastInsertRowid);
    const pubTiga = Number(insertPub.run('Tiga Serangkai', 'Solo').lastInsertRowid);

    const insertAuthor = db.prepare('INSERT INTO authors (name, country) VALUES (?, ?)');
    const aut1 = Number(insertAuthor.run('Kak Bimo & Tim Literasi', 'Indonesia').lastInsertRowid);
    const aut2 = Number(insertAuthor.run('Watiek Ideo', 'Indonesia').lastInsertRowid);
    const aut3 = Number(insertAuthor.run('Tim Kurikulum Merdeka SD', 'Indonesia').lastInsertRowid);
    const aut4 = Number(insertAuthor.run('Dr. Yohanes Surya & Tim', 'Indonesia').lastInsertRowid);
    const aut5 = Number(insertAuthor.run('Nadia R. Utami', 'Indonesia').lastInsertRowid);
    const aut6 = Number(insertAuthor.run('Rizki Pratama', 'Indonesia').lastInsertRowid);
    const aut7 = Number(insertAuthor.run('Dewi Lestari Sari', 'Indonesia').lastInsertRowid);
    const aut8 = Number(insertAuthor.run('Tim Ensiklopedia Cilik', 'Indonesia').lastInsertRowid);

    // 8. Books & Copies (10 Judul SD, 28 Eksemplar)
    const insertBook = db.prepare(`
      INSERT INTO books (title, isbn, edition, publish_year, language, description, pages, cover_url, price, publisher_id, category_id, subcategory, is_reference_only, read_in_place_only, acquisition_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const linkAuthor = db.prepare('INSERT INTO book_authors (book_id, author_id) VALUES (?, ?)');
    const linkCat = db.prepare('INSERT INTO book_categories (book_id, category_id) VALUES (?, ?)');
    const insertCopy = db.prepare(`
      INSERT INTO book_copies (book_id, inventory_code, barcode, shelf_id, condition, status, acquisition_date, price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const booksSeed = [
      {
        title: 'Petualangan Kancil di Hutan Nusantara',
        isbn: '978-602-291-001-1',
        edition: 'Cetakan 3 Bergambar',
        year: 2024,
        lang: 'Indonesia',
        desc: 'Kumpulan fabel jenaka tentang kecerdikan Kancil menolong sahabat-sahabatnya di hutan tropis, dilengkapi pesan moral persahabatan untuk siswa kelas 1–4 SD.',
        pages: 72,
        cover: '/images/cover-cerita-anak.jpg',
        price: 55000,
        pub: pubMizan,
        cat: catCerita,
        sub: 'Fabel & Dongeng Anak',
        ref: 0,
        readOnly: 0,
        author: aut1,
        shelf: shelfCerita,
        copies: 4,
      },
      {
        title: 'Matematika Gembira Kelas 4 SD: Pecahan & Bangun Datar',
        isbn: '978-602-291-002-8',
        edition: 'Kurikulum Merdeka',
        year: 2025,
        lang: 'Indonesia',
        desc: 'Buku pendamping belajar berhitung dengan ilustrasi benda sehari-hari, permainan teka-teki angka, dan latihan soal bertahap untuk kelas 4 SD.',
        pages: 148,
        cover: '/images/cover-pelajaran-sd.jpg',
        price: 68000,
        pub: pubKemendikbud,
        cat: catPelajaran,
        sub: 'Matematika SD',
        ref: 0,
        readOnly: 0,
        author: aut3,
        shelf: shelfPelajaran,
        copies: 4,
      },
      {
        title: 'Mengenal Tata Surya & Rahasia Bintang untuk Anak',
        isbn: '978-602-412-003-5',
        edition: 'Cetakan 2 Full Color',
        year: 2025,
        lang: 'Indonesia',
        desc: 'Mengajak siswa SD menjelajahi delapan planet, fase bulan, dan roket antariksa dengan bahasa sederhana serta infografis penuh warna.',
        pages: 96,
        cover: '/images/cover-sains-sd.jpg',
        price: 85000,
        pub: pubErlangga,
        cat: catSains,
        sub: 'Astronomi Anak',
        ref: 0,
        readOnly: 0,
        author: aut4,
        shelf: shelfSains,
        copies: 3,
      },
      {
        title: 'Kisah Legenda Nusantara: Dari Sabang sampai Merauke',
        isbn: '978-979-973-004-2',
        edition: 'Edisi Ilustrasi',
        year: 2023,
        lang: 'Indonesia',
        desc: 'Antologi cerita rakyat pilihan seperti Danau Toba, Malin Kundang, dan Cendrawasih yang menumbuhkan cinta tanah air bagi pembaca cilik.',
        pages: 112,
        cover: '/images/cover-budaya-sd.jpg',
        price: 72000,
        pub: pubBip,
        cat: catBudaya,
        sub: 'Cerita Rakyat Indonesia',
        ref: 0,
        readOnly: 0,
        author: aut2,
        shelf: shelfBudaya,
        copies: 3,
      },
      {
        title: 'Aku Anak Jujur dan Berani: Cerita Karakter Harian',
        isbn: '978-979-461-005-9',
        edition: 'Cetakan 5',
        year: 2024,
        lang: 'Indonesia',
        desc: 'Kisah-kisah ringan di lingkungan sekolah dasar tentang sikap jujur, antre tertib, saling membantu, dan menjaga kebersihan kelas.',
        pages: 64,
        cover: '/images/cover-cerita-anak.jpg',
        price: 48000,
        pub: pubTiga,
        cat: catKarakter,
        sub: 'Pendidikan Karakter',
        ref: 0,
        readOnly: 0,
        author: aut5,
        shelf: shelfBudaya,
        copies: 3,
      },
      {
        title: 'Bahasa Indonesia Kelas 5 SD: Aku Suka Membaca',
        isbn: '978-602-433-006-6',
        edition: 'Kurikulum Merdeka',
        year: 2024,
        lang: 'Indonesia',
        desc: 'Panduan membaca pemahaman, menulis puisi sederhana, menyusun laporan pengamatan, dan berdiskusi santun di kelas.',
        pages: 164,
        cover: '/images/cover-pelajaran-sd.jpg',
        price: 62000,
        pub: pubKemendikbud,
        cat: catPelajaran,
        sub: 'Bahasa Indonesia SD',
        ref: 0,
        readOnly: 0,
        author: aut3,
        shelf: shelfPelajaran,
        copies: 3,
      },
      {
        title: '15 Eksperimen Sains Seru dari Dapur Rumah',
        isbn: '978-602-291-007-3',
        edition: 'Cetakan 1',
        year: 2025,
        lang: 'Indonesia',
        desc: 'Panduan praktik sains aman untuk siswa kelas 3–6 SD menggunakan bahan dapur seperti gunung berapi soda kue dan pelangi gelas.',
        pages: 88,
        cover: '/images/cover-sains-sd.jpg',
        price: 78000,
        pub: pubErlangga,
        cat: catSains,
        sub: 'Praktik IPA SD',
        ref: 0,
        readOnly: 0,
        author: aut6,
        shelf: shelfSains,
        copies: 2,
      },
      {
        title: 'Kreasi Origami & Kerajinan Kertas Nusantara',
        isbn: '978-979-229-008-0',
        edition: 'Cetakan 4',
        year: 2024,
        lang: 'Indonesia',
        desc: 'Langkah demi langkah melipat kertas menjadi hewan, perahu pinisi, dan hiasan dinding untuk melatih motorik halus siswa SD.',
        pages: 80,
        cover: '/images/cover-budaya-sd.jpg',
        price: 54000,
        pub: pubBip,
        cat: catKesenian,
        sub: 'Prakarya & Seni',
        ref: 0,
        readOnly: 0,
        author: aut7,
        shelf: shelfCerita,
        copies: 2,
      },
      {
        title: 'Ensiklopedia Bergambar Dunia Hewan Nusantara',
        isbn: '978-602-433-009-7',
        edition: 'Edisi Referensi Sekolah',
        year: 2024,
        lang: 'Indonesia',
        desc: 'Ensiklopedia hardcover penuh ilustrasi mengenai komodo, orangutan, badak bercula satu, dan burung cenderawasih. Khusus koleksi referensi baca di tempat.',
        pages: 224,
        cover: '/images/cover-sains-sd.jpg',
        price: 195000,
        pub: pubErlangga,
        cat: catSains,
        sub: 'Ensiklopedia Anak',
        ref: 1,
        readOnly: 1,
        author: aut8,
        shelf: shelfRef,
        copies: 2,
      },
      {
        title: 'Kamus Bergambar Bahasa Indonesia–Inggris SD',
        isbn: '978-602-412-010-3',
        edition: 'Edisi Meja Referensi',
        year: 2023,
        lang: 'Indonesia / Inggris',
        desc: 'Kamus tematik dengan 1.500 kosakata bergambar untuk siswa sekolah dasar. Koleksi referensi khusus dibaca di ruang perpustakaan.',
        pages: 260,
        cover: '/images/cover-pelajaran-sd.jpg',
        price: 160000,
        pub: pubBip,
        cat: catPelajaran,
        sub: 'Kamus Sekolah',
        ref: 1,
        readOnly: 1,
        author: aut8,
        shelf: shelfRef,
        copies: 2,
      },
    ];

    let copySeq = 1;
    const bookIds: number[] = [];
    const copyIdsByBook = new Map<number, number[]>();

    for (const b of booksSeed) {
      const bid = Number(
        insertBook.run(
          b.title,
          b.isbn,
          b.edition,
          b.year,
          b.lang,
          b.desc,
          b.pages,
          b.cover,
          b.price,
          b.pub,
          b.cat,
          b.sub,
          b.ref,
          b.readOnly,
          '2026-07-15'
        ).lastInsertRowid
      );
      bookIds.push(bid);
      linkAuthor.run(bid, b.author);
      linkCat.run(bid, b.cat);

      const cids: number[] = [];
      for (let i = 0; i < b.copies; i++) {
        const code = `LP-2026-${String(copySeq).padStart(4, '0')}`;
        const barcode = `BC${String(20260000 + copySeq)}`;
        const cid = Number(
          insertCopy.run(
            bid,
            code,
            barcode,
            b.shelf,
            'Baik',
            'Tersedia',
            '2026-07-15',
            b.price,
            ''
          ).lastInsertRowid
        );
        cids.push(cid);
        copySeq++;
      }
      copyIdsByBook.set(bid, cids);
    }

    // 9. Historical & Active Loans + Returns + Fines + Reservations
    const insertLoan = db.prepare(`
      INSERT INTO loans (loan_number, idempotency_key, member_id, staff_user_id, loan_date, due_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLoanItem = db.prepare(`
      INSERT INTO loan_items (loan_id, copy_id, due_date, returned_at, status, renewal_count, return_condition)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateCopyStatus = db.prepare('UPDATE book_copies SET status = ?, condition = ? WHERE id = ?');
    const insertReturn = db.prepare(`
      INSERT INTO returns (return_number, loan_id, loan_item_id, copy_id, staff_user_id, returned_at, condition, status, overdue_days, fine_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFine = db.prepare(`
      INSERT INTO fines (fine_number, member_id, loan_id, return_id, fine_type, amount, paid_amount, waived_amount, status, reason, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPayment = db.prepare(`
      INSERT INTO payments (payment_number, fine_id, member_id, amount, method, received_by_user_id, paid_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const b0Copies = copyIdsByBook.get(bookIds[0])!;
    const b1Copies = copyIdsByBook.get(bookIds[1])!;
    const b2Copies = copyIdsByBook.get(bookIds[2])!;
    const b3Copies = copyIdsByBook.get(bookIds[3])!;
    const b4Copies = copyIdsByBook.get(bookIds[4])!;
    const b6Copies = copyIdsByBook.get(bookIds[6])!;

    // Completed historical loan 1 (returned on time)
    const l1 = Number(
      insertLoan.run('PJM-2026-0001', 'seed-l1', m1, uPustakawan, '2026-10-18', '2026-10-25', 'Selesai', 'Bacaan pojok literasi kelas 5A').lastInsertRowid
    );
    const li1 = Number(insertLoanItem.run(l1, b0Copies[0], '2026-10-25', '2026-10-24', 'Dikembalikan', 0, 'Baik').lastInsertRowid);
    insertReturn.run('KMB-2026-0001', l1, li1, b0Copies[0], uPustakawan, '2026-10-24', 'Baik', 'Tepat Waktu', 0, 0, '');

    // Completed historical loan 2 (returned late with paid fine)
    const l2 = Number(
      insertLoan.run('PJM-2026-0002', 'seed-l2', m3, uPustakawan, '2026-10-20', '2026-10-27', 'Selesai', '').lastInsertRowid
    );
    const li2 = Number(insertLoanItem.run(l2, b2Copies[0], '2026-10-27', '2026-10-30', 'Dikembalikan', 0, 'Baik').lastInsertRowid);
    const r2 = Number(insertReturn.run('KMB-2026-0002', l2, li2, b2Copies[0], uPustakawan, '2026-10-30', 'Baik', 'Terlambat', 3, 1500, 'Terlambat 3 hari').lastInsertRowid);
    const f1 = Number(insertFine.run('DND-2026-0001', m3, l2, r2, 'Keterlambatan', 1500, 1500, 0, 'Lunas', 'Terlambat 3 hari (KMB-2026-0002)', uPustakawan).lastInsertRowid);
    insertPayment.run('BYR-2026-0001', f1, m3, 1500, 'Tunai', uPustakawan, '2026-10-30 10:15:00', 'Dibayar tunai di meja pustakawan');

    // Completed historical loan 3 (recent return for chart)
    const l3 = Number(
      insertLoan.run('PJM-2026-0003', 'seed-l3', m4, uPustakawan, '2026-11-05', '2026-11-12', 'Selesai', '').lastInsertRowid
    );
    const li3 = Number(insertLoanItem.run(l3, b4Copies[0], '2026-11-12', '2026-11-12', 'Dikembalikan', 0, 'Baik').lastInsertRowid);
    insertReturn.run('KMB-2026-0003', l3, li3, b4Copies[0], uPustakawan, '2026-11-12', 'Baik', 'Tepat Waktu', 0, 0, '');

    // Active loan 4 (m1 / Bima — currently borrowed, due 2026-11-22)
    const l4 = Number(
      insertLoan.run('PJM-2026-0004', 'seed-l4', m1, uPustakawan, '2026-11-15', '2026-11-22', 'Aktif', 'Tugas merangkum cerita anak').lastInsertRowid
    );
    insertLoanItem.run(l4, b0Copies[1], '2026-11-22', null, 'Dipinjam', 0, null);
    updateCopyStatus.run('Dipinjam', 'Baik', b0Copies[1]);
    insertLoanItem.run(l4, b1Copies[0], '2026-11-22', null, 'Dipinjam', 0, null);
    updateCopyStatus.run('Dipinjam', 'Baik', b1Copies[0]);

    // Active loan 5 (m2 / Ibu Nadia — currently borrowed for class)
    const l5 = Number(
      insertLoan.run('PJM-2026-0005', 'seed-l5', m2, uPustakawan, '2026-11-14', '2026-11-28', 'Aktif', 'Materi pembelajaran IPA kelas 4A').lastInsertRowid
    );
    insertLoanItem.run(l5, b6Copies[0], '2026-11-28', null, 'Dipinjam', 0, null);
    updateCopyStatus.run('Dipinjam', 'Baik', b6Copies[0]);

    // Active loan 6 (m7 / Fajar — OVERDUE since 2026-11-10!)
    const l6 = Number(
      insertLoan.run('PJM-2026-0006', 'seed-l6', m7, uPustakawan, '2026-11-03', '2026-11-10', 'Terlambat', 'Sudah diingatkan lewat wali kelas').lastInsertRowid
    );
    insertLoanItem.run(l6, b3Copies[0], '2026-11-10', null, 'Terlambat', 0, null);
    updateCopyStatus.run('Dipinjam', 'Baik', b3Copies[0]);

    // Active loan 7 (m5 / Pak Hendra — borrowed today 2026-11-17)
    const l7 = Number(
      insertLoan.run('PJM-2026-0007', 'seed-l7', m5, uPustakawan, '2026-11-17', '2026-12-01', 'Aktif', 'Persiapan proyek sains siswa').lastInsertRowid
    );
    insertLoanItem.run(l7, b2Copies[1], '2026-12-01', null, 'Dipinjam', 0, null);
    updateCopyStatus.run('Dipinjam', 'Baik', b2Copies[1]);

    // Unpaid fine for m7 (from earlier damage incident)
    insertFine.run(
      'DND-2026-0002',
      m7,
      null,
      null,
      'Kerusakan',
      15000,
      0,
      0,
      'Belum Lunas',
      'Sampul buku robek pada peminjaman sebelumnya',
      uPustakawan
    );

    // 10. Reservations
    const insertRes = db.prepare(`
      INSERT INTO reservations (reservation_number, book_id, copy_id, member_id, queue_position, status, reserved_at, expires_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRes.run('RSV-2026-0001', bookIds[0], null, m4, 1, 'Menunggu', '2026-11-16 09:30:00', null, 'Untuk kegiatan literasi pagi kelas 6B');
    insertRes.run('RSV-2026-0002', bookIds[2], null, m5, 1, 'Menunggu', '2026-11-17 10:15:00', null, 'Dipinjam untuk alat bantu ajar tata surya');

    // 11. Suppliers & Acquisitions (Pemasok Buku Sekolah)
    const insertSupplier = db.prepare(`
      INSERT INTO suppliers (code, name, contact_person, phone, email, address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const sup1 = Number(
      insertSupplier.run(
        'SUP-001',
        'CV Pustaka Edukasi Anak',
        'Bagus Setiawan',
        '022-4231990',
        'order@pustakaedukasi.co.id',
        'Jl. Merdeka No. 45, Bandung'
      ).lastInsertRowid
    );
    const sup2 = Number(
      insertSupplier.run(
        'SUP-002',
        'PT Aksara Sekolah Nusantara',
        'Lina Marlina',
        '021-5790221',
        'sales@aksarasekolah.co.id',
        'Jl. Sudirman Kav. 12, Jakarta'
      ).lastInsertRowid
    );

    const insertAcq = db.prepare(`
      INSERT INTO acquisitions (request_number, title_summary, supplier_id, requested_by_user_id, approved_by_user_id, order_date, received_date, total_estimated_cost, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAcqItem = db.prepare(`
      INSERT INTO acquisition_items (acquisition_id, title, isbn, author_name, publisher_name, category_name, quantity_ordered, quantity_received, unit_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const acq1 = Number(
      insertAcq.run(
        'PGD-2026-0001',
        'Pengadaan Buku Cerita Bergambar & Literasi Kelas 1–3',
        sup1,
        uPustakawan,
        uKepala,
        '2026-11-01',
        '2026-11-10',
        620000,
        'Selesai',
        'Diterima lengkap dan telah disusun di pojok baca'
      ).lastInsertRowid
    );
    insertAcqItem.run(acq1, 'Seri Aku Suka Membaca: Sahabat Hutan', '978-602-291-111-7', 'Kak Bimo', 'Mizan Pelangi', 'Cerita Anak & Dongeng', 5, 5, 60000, 'Diterima');
    insertAcqItem.run(acq1, 'Belajar Membaca Lancar untuk Kelas 1 SD', '978-602-291-112-4', 'Tim Literasi SD', 'Erlangga for Kids', 'Buku Pelajaran & Tematik', 5, 5, 64000, 'Diterima');

    const acq2 = Number(
      insertAcq.run(
        'PGD-2026-0002',
        'Usulan Buku Eksperimen Sains & Cerita Rakyat Semester Genap',
        sup2,
        uPustakawan,
        null,
        null,
        null,
        740000,
        'Menunggu Persetujuan',
        'Usulan guru kelas 4–6 untuk pojok sains sekolah'
      ).lastInsertRowid
    );
    insertAcqItem.run(acq2, 'Seri Pahlawan Kemerdekaan untuk Siswa SD', '978-602-412-220-5', 'Watiek Ideo', 'Bhuana Ilmu Populer', 'Sejarah & Budaya Indonesia', 5, 0, 76000, 'Menunggu');
    insertAcqItem.run(acq2, 'Ensiklopedia Mini Dinosaurus & Fosil', '978-979-461-221-3', 'Tim Ensiklopedia Cilik', 'Erlangga for Kids', 'Sains & Eksperimen Anak', 4, 0, 90000, 'Menunggu');

    // 12. Inventory Audit (Stock Opname)
    const insertAudit = db.prepare(`
      INSERT INTO inventory_audits (audit_number, title, shelf_id, conducted_by_user_id, started_at, completed_at, status, total_expected, total_scanned, total_discrepancy, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const aud1 = Number(
      insertAudit.run(
        'OPN-2026-0001',
        'Stock Opname Pojok Baca & Rak Sains SD',
        shelfSains,
        uPustakawan,
        '2026-11-12 08:00:00',
        '2026-11-12 10:00:00',
        'Selesai',
        5,
        5,
        0,
        'Seluruh buku sains dan eksperimen cilik sesuai catatan sistem'
      ).lastInsertRowid
    );
    const insertAuditItem = db.prepare(`
      INSERT INTO inventory_audit_items (audit_id, copy_id, expected_status, physical_status, notes)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const cid of b6Copies) {
      insertAuditItem.run(
        aud1,
        cid,
        cid === b6Copies[0] ? 'Dipinjam' : 'Tersedia',
        'Ditemukan',
        'Terverifikasi'
      );
    }

    // 13. Notifications
    const insertNotif = db.prepare(`
      INSERT INTO notifications (user_id, member_id, type, title, message, link, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertNotif.run(
      uPustakawan,
      null,
      'warning',
      'Keterlambatan Pengembalian Siswa',
      'Pinjaman PJM-2026-0006 (Fajar Nugroho, Kelas 6A) melewati jatuh tempo sejak 2026-11-10.',
      '/returns',
      0
    );
    insertNotif.run(
      uKepala,
      null,
      'info',
      'Pengadaan Buku Menunggu Persetujuan',
      'Pengajuan PGD-2026-0002 senilai Rp 740.000 membutuhkan persetujuan Kepala Perpustakaan.',
      '/acquisitions',
      0
    );
    insertNotif.run(
      uAnggota,
      m1,
      'info',
      'Pengingat Jatuh Tempo',
      'Peminjaman PJM-2026-0004 (2 buku) akan jatuh tempo pada 2026-11-22.',
      '/loans',
      0
    );
    insertNotif.run(
      uPustakawan,
      null,
      'info',
      'Masa Keanggotaan Akan Berakhir',
      'Keanggotaan Dewi Anggraini (AGT-2026-0006) berakhir pada 2026-11-25.',
      '/members',
      1
    );

    // 14. Library Settings
    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO library_settings (key, value, updated_by_user_id) VALUES (?, ?, ?)
    `);
    const defaultSettings: Array<[string, string]> = [
      ['library_name', 'Perpustakaan SD Lentera Pustaka'],
      ['library_tagline', 'Taman Baca & Pusat Literasi Siswa Sekolah Dasar'],
      ['library_address', 'Jl. Tamansari No. 42, Bandung 40132'],
      ['library_phone', '(022) 250-4812'],
      ['library_email', 'perpustakaan@sdlenterapustaka.sch.id'],
      ['operating_hours', 'Senin–Jumat 07:00–14:30 | Sabtu 08:00–12:00'],
      ['grace_period_days', '1'],
      ['default_damage_fee_percent', '50'],
      ['allow_partial_fine_payment', 'true'],
      ['allow_overdue_renewal', 'false'],
      ['block_on_unpaid_fines_limit', '20000'],
      ['reservation_pickup_hours', '48'],
      ['member_code_prefix', 'AGT-2026-'],
      ['inventory_code_prefix', 'LP-2026-'],
      ['policy_application_mode', 'new_transactions_only'],
      ['notify_due_days_before', '2'],
    ];
    for (const [k, v] of defaultSettings) {
      insertSetting.run(k, v, uAdmin);
    }

    // 15. Initial Audit Logs
    const insertAuditLog = db.prepare(`
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, after_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertAuditLog.run(
      uAdmin,
      'Arif Rahman (Operator Sekolah)',
      'SYSTEM_INIT',
      'library_settings',
      'global',
      JSON.stringify({ initialized: true, schoolLevel: 'SD' })
    );
    insertAuditLog.run(
      uPustakawan,
      'Pak Dimas Prasetyo, S.I.Pust.',
      'LOAN_CREATE',
      'loans',
      'PJM-2026-0004',
      JSON.stringify({ member: 'AGT-2026-0001', items: 2 })
    );
    insertAuditLog.run(
      uPustakawan,
      'Pak Dimas Prasetyo, S.I.Pust.',
      'FINE_PAYMENT',
      'payments',
      'BYR-2026-0001',
      JSON.stringify({ amount: 1500, method: 'Tunai' })
    );
  })();

  seedReadingSchedules(db);
  seedClassRostersAndAttendance(db);
}

export function seedReadingSchedules(db: Database.Database): void {
  db.transaction(() => {
    // 1. Ensure schedules.read & schedules.write permissions exist for pre-existing DBs
    const permDefs: Array<[string, string, string]> = [
      ['schedules.read', 'Lihat Jadwal Baca Kelas', 'schedules'],
      ['schedules.write', 'Kelola Jadwal & Catat Sesi Baca', 'schedules'],
    ];
    const insertPerm = db.prepare(
      'INSERT OR IGNORE INTO permissions (code, name, module) VALUES (?, ?, ?)'
    );
    const getPerm = db.prepare('SELECT id FROM permissions WHERE code = ?');
    const assignPerm = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    );
    const roleRows = db.prepare('SELECT id, slug FROM roles').all() as Array<{ id: number; slug: string }>;

    for (const [code, name, mod] of permDefs) {
      insertPerm.run(code, name, mod);
      const pRow = getPerm.get(code) as { id: number } | undefined;
      if (!pRow) continue;
      for (const r of roleRows) {
        if (
          r.slug === 'super_admin' ||
          r.slug === 'kepala_perpustakaan' ||
          r.slug === 'pustakawan' ||
          (r.slug === 'anggota' && code === 'schedules.read')
        ) {
          assignPerm.run(r.id, pRow.id);
        }
      }
    }

    // 2. Seed all 12 SD class reading schedules idempotently
    const existingCount = (
      db.prepare('SELECT COUNT(*) as c FROM reading_schedules').get() as { c: number }
    ).c;
    if (existingCount > 0) return;

    const books = db
      .prepare('SELECT id, title FROM books WHERE archived_at IS NULL ORDER BY id ASC')
      .all() as Array<{ id: number; title: string }>;
    const pustakawan = db
      .prepare("SELECT id, full_name FROM users WHERE username = 'pustakawan' LIMIT 1")
      .get() as { id: number; full_name: string } | undefined;

    const bookAt = (idx: number) => books[idx % Math.max(books.length, 1)]?.id ?? null;

    const seedSlots = [
      {
        code: 'JDW-2026-0001',
        className: 'Kelas 1A',
        grade: 1,
        teacher: 'Ibu Sari Rahayu, S.Pd.',
        students: 26,
        day: 'Senin',
        start: '07:15',
        end: '07:50',
        area: 'Pojok Baca Karpet',
        mode: 'Membaca Bersama',
        theme: 'Mengenal Fabel Nusantara & Hewan Hutan',
        bookIdx: 0,
        status: 'Selesai',
        present: 25,
        booksRead: 26,
        notes: 'Siswa antusias menirukan dialog kancil bersama wali kelas.',
        completedAt: '2026-11-16 07:55:00',
        logDate: '2026-11-16',
      },
      {
        code: 'JDW-2026-0002',
        className: 'Kelas 1B',
        grade: 1,
        teacher: 'Ibu Rina Kartika, S.Pd.',
        students: 25,
        day: 'Senin',
        start: '08:00',
        end: '08:40',
        area: 'Pojok Baca Karpet',
        mode: 'Membaca Bersama',
        theme: 'Cerita Bergambar Sikap Jujur & Santun',
        bookIdx: 4,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0003',
        className: 'Kelas 2A',
        grade: 2,
        teacher: 'Ibu Dewi Lestari, S.Pd.',
        students: 27,
        day: 'Selasa',
        start: '07:15',
        end: '07:50',
        area: 'Pojok Baca Karpet',
        mode: 'Literasi Pagi',
        theme: 'Membaca Lancar & Kreasi Origami Kertas',
        bookIdx: 7,
        status: 'Selesai',
        present: 27,
        booksRead: 31,
        notes: 'Semua siswa hadir dan mempraktikkan lipat perahu kertas.',
        completedAt: '2026-11-17 07:52:00',
        logDate: '2026-11-17',
      },
      {
        code: 'JDW-2026-0004',
        className: 'Kelas 2B',
        grade: 2,
        teacher: 'Ibu Maya Puspita, S.Pd.',
        students: 26,
        day: 'Selasa',
        start: '08:00',
        end: '08:40',
        area: 'Pojok Baca Karpet',
        mode: 'Membaca Bersama',
        theme: 'Petualangan Dongeng & Nilai Persahabatan',
        bookIdx: 0,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0005',
        className: 'Kelas 3A',
        grade: 3,
        teacher: 'Pak Budi Santoso, S.Pd.',
        students: 28,
        day: 'Rabu',
        start: '07:15',
        end: '07:55',
        area: 'Sudut Sains & Budaya',
        mode: 'Kunjungan Tematik',
        theme: 'Cerita Rakyat dari Sabang sampai Merauke',
        bookIdx: 3,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0006',
        className: 'Kelas 3B',
        grade: 3,
        teacher: 'Ibu Fitriani Putri, S.Pd.',
        students: 27,
        day: 'Rabu',
        start: '08:10',
        end: '08:50',
        area: 'Pojok Baca Karpet',
        mode: 'Membaca Mandiri',
        theme: 'Pendidikan Karakter & Kebiasaan Baik',
        bookIdx: 4,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0007',
        className: 'Kelas 4A',
        grade: 4,
        teacher: 'Ibu Nadia Kusuma, S.Pd.',
        students: 28,
        day: 'Kamis',
        start: '07:15',
        end: '07:55',
        area: 'Sudut Sains & Budaya',
        mode: 'Kunjungan Tematik',
        theme: 'Pecahan Gembira & Eksperimen IPA Dapur',
        bookIdx: 1,
        status: 'Berlangsung',
        present: 0,
        booksRead: 0,
        notes: 'Sesi baca tematik minggu ini didampingi wali kelas.',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0008',
        className: 'Kelas 4B',
        grade: 4,
        teacher: 'Pak Eko Prasetyo, S.Pd.',
        students: 28,
        day: 'Kamis',
        start: '08:15',
        end: '08:55',
        area: 'Sudut Sains & Budaya',
        mode: 'Membaca Mandiri',
        theme: 'Eksplorasi Dunia Hewan Nusantara',
        bookIdx: 8,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0009',
        className: 'Kelas 5A',
        grade: 5,
        teacher: 'Ibu Ratna Sari, S.Pd.',
        students: 29,
        day: 'Jumat',
        start: '07:15',
        end: '07:55',
        area: 'Meja Referensi & Kamus',
        mode: 'Literasi Pagi',
        theme: 'Aku Suka Membaca & Menulis Ringkasan',
        bookIdx: 5,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0010',
        className: 'Kelas 5B',
        grade: 5,
        teacher: 'Pak Hendra Gunawan, S.Pd.',
        students: 28,
        day: 'Jumat',
        start: '08:15',
        end: '08:55',
        area: 'Sudut Sains & Budaya',
        mode: 'Diskusi & Resensi',
        theme: 'Mengenal Tata Surya & Planet',
        bookIdx: 2,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0011',
        className: 'Kelas 6A',
        grade: 6,
        teacher: 'Pak Agus Wijaya, S.Pd.',
        students: 30,
        day: 'Sabtu',
        start: '08:00',
        end: '08:45',
        area: 'Meja Referensi & Kamus',
        mode: 'Diskusi & Resensi',
        theme: 'Bedah Kamus Dwibahasa & Literasi Ujian',
        bookIdx: 9,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
      {
        code: 'JDW-2026-0012',
        className: 'Kelas 6B',
        grade: 6,
        teacher: 'Ibu Yuniarti, S.Pd.',
        students: 29,
        day: 'Sabtu',
        start: '09:00',
        end: '09:45',
        area: 'Teras Baca Taman',
        mode: 'Diskusi & Resensi',
        theme: 'Resensi Legenda Nusantara & Presentasi Kelompok',
        bookIdx: 3,
        status: 'Terjadwal',
        present: 0,
        booksRead: 0,
        notes: '',
        completedAt: null,
        logDate: null,
      },
    ];

    const insertSched = db.prepare(`
      INSERT INTO reading_schedules (
        schedule_code, class_name, grade_level, homeroom_teacher, companion_teacher, student_count,
        day_of_week, start_time, end_time, room_area, reading_mode, reading_theme,
        book_id, status, students_present, books_read_count, session_notes, completed_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLog = db.prepare(`
      INSERT INTO reading_schedule_logs (
        schedule_id, session_date, status, students_present, books_read_count, notes, recorded_by_user_id, recorded_by_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of seedSlots) {
      const preset = getClassPreset(s.className);
      const schedId = Number(
        insertSched.run(
          s.code,
          s.className,
          s.grade,
          preset?.homeroomTeacher ?? s.teacher,
          preset?.companionTeacher ?? '',
          preset?.studentCount ?? 10,
          s.day,
          s.start,
          s.end,
          s.area,
          s.mode,
          s.theme,
          bookAt(s.bookIdx),
          s.status,
          s.status === 'Selesai' ? 9 : 0,
          s.status === 'Selesai' ? (s.className === 'Kelas 1A' ? 11 : 12) : 0,
          s.notes,
          s.completedAt,
          pustakawan?.id ?? null
        ).lastInsertRowid
      );

      if (s.logDate) {
        insertLog.run(
          schedId,
          s.logDate,
          s.status,
          9,
          s.className === 'Kelas 1A' ? 11 : 12,
          s.notes,
          pustakawan?.id ?? null,
          pustakawan?.full_name ?? 'Pak Dimas Prasetyo, S.I.Pust.'
        );
      }
    }
  })();
}

export function seedClassRostersAndAttendance(db: Database.Database): void {
  db.transaction(() => {
    // 1. Seed all 12 SD classes with Wali Kelas + Guru Pendamping idempotently
    const insertClass = db.prepare(`
      INSERT OR IGNORE INTO school_classes (class_name, grade_level, homeroom_teacher, companion_teacher)
      VALUES (?, ?, ?, ?)
    `);
    for (const cls of SD_CLASSES) {
      insertClass.run(cls.className, cls.gradeLevel, cls.homeroomTeacher, cls.companionTeacher);
    }

    // 2. Seed 10 students per class (120 students across Kelas 1A–6B) idempotently
    const existingStudents = (
      db.prepare('SELECT COUNT(*) as c FROM class_students').get() as { c: number }
    ).c;
    if (existingStudents === 0) {
      const insertStudent = db.prepare(`
        INSERT OR IGNORE INTO class_students (class_name, student_code, full_name, gender, status, notes)
        VALUES (?, ?, ?, ?, 'Aktif', '')
      `);
      for (const cls of SD_CLASSES) {
        const roster = buildSeedStudentsForClass(cls.className);
        for (const st of roster) {
          insertStudent.run(cls.className, st.studentCode, st.fullName, st.gender);
        }
      }
    }

    // 3. Backfill companion_teacher on pre-existing reading_schedules rows where empty
    db.prepare(`
      UPDATE reading_schedules
      SET companion_teacher = COALESCE(
        (SELECT sc.companion_teacher FROM school_classes sc WHERE sc.class_name = reading_schedules.class_name),
        ''
      )
      WHERE companion_teacher = ''
    `).run();

    // 4. Backfill per-student attendance for seeded completed logs & align seeded student_count
    const existingAttendance = (
      db.prepare('SELECT COUNT(*) as c FROM reading_session_attendance').get() as { c: number }
    ).c;

    if (existingAttendance === 0) {
      // Align migrated seed schedules that still carry old placeholder counts (> 10) to active roster size
      const classCounts = db
        .prepare(
          `SELECT class_name, COUNT(*) as c FROM class_students WHERE archived_at IS NULL GROUP BY class_name`
        )
        .all() as Array<{ class_name: string; c: number }>;
      const updateSchedCount = db.prepare(
        `UPDATE reading_schedules SET student_count = ? WHERE class_name = ? AND student_count > ?`
      );
      for (const cc of classCounts) {
        updateSchedCount.run(cc.c, cc.class_name, cc.c);
      }

      const logs = db
        .prepare(
          `SELECT l.id as log_id, l.schedule_id, s.class_name, s.schedule_code
           FROM reading_schedule_logs l
           JOIN reading_schedules s ON s.id = l.schedule_id
           ORDER BY l.id ASC`
        )
        .all() as Array<{
        log_id: number;
        schedule_id: number;
        class_name: string;
        schedule_code: string;
      }>;

      const getClassStudents = db.prepare(
        `SELECT id, student_code, full_name
         FROM class_students
         WHERE class_name = ? AND archived_at IS NULL
         ORDER BY student_code ASC`
      );
      const insertAtt = db.prepare(`
        INSERT OR IGNORE INTO reading_session_attendance (
          log_id, schedule_id, student_id, student_code, student_name, status, books_read, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateLogSummary = db.prepare(
        `UPDATE reading_schedule_logs SET students_present = ?, books_read_count = ? WHERE id = ?`
      );
      const updateSchedSummary = db.prepare(
        `UPDATE reading_schedules SET students_present = ?, books_read_count = ? WHERE id = ?`
      );

      for (const log of logs) {
        const students = getClassStudents.all(log.class_name) as Array<{
          id: number;
          student_code: string;
          full_name: string;
        }>;
        if (students.length === 0) continue;

        let present = 0;
        let totalBooks = 0;

        students.forEach((st, idx) => {
          let status: 'Hadir' | 'Izin' | 'Sakit' | 'Alpa' = 'Hadir';
          let note = '';
          let booksRead = idx < 2 ? 2 : 1;

          if (log.class_name === 'Kelas 1A' && idx === 6) {
            status = 'Sakit';
            note = 'Demam ringan (surat orang tua)';
            booksRead = 0;
          } else if (log.class_name === 'Kelas 2A' && idx === 4) {
            status = 'Izin';
            note = 'Izin acara keluarga';
            booksRead = 0;
          }

          if (status === 'Hadir') {
            present++;
            totalBooks += booksRead;
          }

          insertAtt.run(
            log.log_id,
            log.schedule_id,
            st.id,
            st.student_code,
            st.full_name,
            status,
            booksRead,
            note
          );
        });

        updateLogSummary.run(present, totalBooks, log.log_id);
        updateSchedSummary.run(present, totalBooks, log.schedule_id);
      }
    }
  })();
}
