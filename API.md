# API.md — Dokumentasi Endpoint API

Seluruh endpoint berada di bawah `/app/api/` dan mengembalikan format JSON. Endpoint terproteksi memeriksa cookie sesi `lentera_session` dan izin RBAC.

| Endpoint | Metode | Izin RBAC | Ringkasan |
| :--- | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | Publik (Rate-limited) | Autentikasi email/username + kata sandi scrypt, set cookie HTTP-only. |
| `/api/auth/logout` | `POST` | Publik | Menghapus cookie sesi. |
| `/api/auth/me` | `GET` | Publik | Mengembalikan sesi aktif, izin, jumlah notifikasi belum dibaca, dan identitas perpustakaan. |
| `/api/catalog` | `GET` | Publik | Katalog OPAC publik (pencarian, filter, terbaru, terpopuler). Tanpa data pribadi anggota. |
| `/api/dashboard` | `GET` | `dashboard.view` | Statistik real-time, tren sirkulasi, kategori populer, dan daftar terlambat. |
| `/api/books` | `GET`, `POST` | `books.read`, `books.write` | Daftar, pencarian, filter, sortir, dan pembuatan judul + eksemplar awal. |
| `/api/books/[id]` | `GET`, `PUT`, `PATCH`, `DELETE` | `books.read/write/archive` | Detail buku, riwayat sirkulasi, tambah eksemplar, update copy, dan soft-archive. |
| `/api/books/import` | `POST` | `books.import_export` | Validasi preview dan commit import CSV/Excel. |
| `/api/members` | `GET`, `POST` | `members.read`, `members.write` | Daftar dan registrasi anggota baru. |
| `/api/members/[id]` | `GET`, `PUT` | `members.read/write/block` | Detail riwayat anggota, edit, perpanjang masa berlaku, blokir/buka blokir, arsip. |
| `/api/loans` | `GET`, `POST` | `loans.read`, `loans.write` | Daftar pinjaman (ter-scope untuk peran Anggota) dan checkout multi-buku atomik. |
| `/api/loans/[id]/renew` | `POST` | `loans.read` / `loans.write` | Perpanjangan item pinjaman dengan validasi antrean reservasi dan batas perpanjangan. |
| `/api/returns` | `GET`, `POST` | `loans.read`, `returns.write` | Daftar pinjaman aktif/riwayat kembali dan proses pengembalian + denda + promosi reservasi. |
| `/api/reservations` | `GET`, `POST`, `PATCH` | `reservations.read/write` | Antrean FIFO reservasi, pembuatan, pembatalan, pengambilan, dan rilis kedaluwarsa. |
| `/api/fines` | `GET`, `POST` | `fines.read`, `fines.pay`, `fines.waive` | Daftar denda, pembayaran parsial/penuh, dan pengecualian resmi. |
| `/api/inventory` | `GET`, `POST` | `inventory.read`, `inventory.write` | Gedung, rak, transfer eksemplar, serta mulai/scan/selesaikan stock opname. |
| `/api/acquisitions` | `GET`, `POST` | `acquisitions.read/write/approve` | Pemasok, pengajuan pengadaan, persetujuan, pemesanan, dan penerimaan ke inventaris. |
| `/api/reports` | `GET` | `reports.read` | Query laporan operasional real-time untuk 14 jenis laporan. |
| `/api/notifications` | `GET`, `PATCH` | `notifications.read` | Pusat notifikasi, tandai dibaca, dan pemindai peringatan jatuh tempo/keterlambatan. |
| `/api/settings` | `GET`, `PUT` | `settings.read`, `settings.write` | Pengaturan global, kebijakan anggota, matriks RBAC, manajemen akun, dan audit log. |
| `/api/backup` | `GET`, `POST` | `settings.write` | Unduh backup JSON dan validasi/restore terkonfirmasi. |
