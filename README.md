# Lentera Pustaka — Sistem Manajemen Perpustakaan Terpadu

Lentera Pustaka adalah aplikasi manajemen perpustakaan (*Library Management System*) berbasis web dengan arsitektur Next.js App Router, TypeScript, Tailwind CSS, dan database relasional SQLite (`better-sqlite3`).

## Fitur Utama

- **Dashboard Operasional Real-Time**: Statistik judul, eksemplar, peminjaman aktif, keterlambatan, tren sirkulasi, kategori terpopuler, dan ringkasan kondisi inventaris.
- **Katalog Publik (OPAC)**: Pencarian koleksi, filter kategori/ketersediaan, lokasi rak, detail buku, dan pengajuan reservasi tanpa membocorkan data pribadi anggota.
- **Manajemen Buku & Eksemplar**: Pemisahan data bibliografi dan inventaris fisik per eksemplar, cetak label QR/Barcode, import Excel/CSV dengan preview validasi, serta export CSV/Excel/PDF.
- **Manajemen Anggota**: Kategori anggota (Siswa, Guru, Staf, Umum, Khusus), registrasi, kartu anggota QR, perpanjangan, blokir sementara, dan riwayat sirkulasi.
- **Sirkulasi (Peminjaman, Pengembalian, Perpanjangan)**: Checkout multi-buku atomik dengan idempotency key, antrean offline lokal, perpanjangan berbasis antrean reservasi, dan pemeriksaan kondisi fisik saat pengembalian.
- **Reservasi & Denda**: Antrean FIFO otomatis dengan kedaluwarsa otomatis, perhitungan denda keterlambatan/kerusakan/kehilangan, pembayaran parsial/penuh, bukti bayar, dan pengecualian resmi.
- **Inventaris & Pengadaan**: Lokasi gedung & rak, stock opname pemindaian fisik dengan laporan selisih, serta siklus pengadaan hingga masuk rak.
- **RBAC, Audit Log & Backup**: 5 peran (Super Admin, Kepala Perpustakaan, Pustakawan, Anggota, Pengunjung) dengan pengecekan izin di setiap endpoint backend, audit log perubahan, dan backup/restore terkonfirmasi.

## Menjalankan Secara Lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`. Database SQLite (`data/library.db`) dibuat, dimigrasi, dan diisi data awal secara otomatis saat permintaan pertama.

## Akun Uji Peran (RBAC)

- **Super Admin**: `admin@lenterapustaka.id` / `admin123`
- **Kepala Perpustakaan**: `kepala@lenterapustaka.id` / `kepala123`
- **Pustakawan**: `pustakawan@lenterapustaka.id` / `pustaka123`
- **Anggota**: `anggota@lenterapustaka.id` / `anggota123`

## Pengujian & Build

```bash
npx --yes tsx --test lib/domain/library-rules.test.ts
npx --yes tsx --test lib/db/integration.test.ts
npm run lint
npm run build
```
