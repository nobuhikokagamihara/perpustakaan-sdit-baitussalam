# AGENTS.md — Panduan Pengembangan untuk Coding Agent

Dokumen ini berisi aturan arsitektur dan batasan yang wajib dipatuhi saat memodifikasi kode Lentera Pustaka.

1. **Pemisahan Layer**:
   - Aturan bisnis murni (perhitungan jatuh tempo, denda, validasi kelayakan pinjam/perpanjang/bayar, selisih stock opname) berada di `/lib/domain/library-rules.ts`. Jangan menduplikasi kalkulasi bisnis di komponen UI.
   - Akses database SQLite dan migrasi berada di `/lib/db/`.
   - Autentikasi, scrypt hashing, token sesi HMAC, rate limiter, dan RBAC berada di `/lib/auth/`.
   - Seluruh operasi mutasi data penting (`loans`, `returns`, `fines`, `books`, `acquisitions`, `backup`) wajib menggunakan `db.transaction(...)` dan mencatat ke `audit_logs` via `logAudit()`.
2. **Keamanan Backend**:
   - Setiap API route operasional wajib memanggil `requirePermission('...')` atau `requireAuth()` dari `/lib/auth/session.ts`.
   - Gunakan parameterized query SQLite (`?`) di seluruh query. Jangan melakukan string interpolation input pengguna ke SQL.
   - Endpoint `/api/catalog` (OPAC publik) dilarang mengembalikan PII anggota atau data internal.
3. **UI & Design System**:
   - Gunakan komponen dari `/components/ui/DesignPrimitives.tsx` dan layout `/components/layout/AppShell.tsx`.
   - Seluruh angka statistik, tabel, dan nominal Rupiah wajib memakai class `tabular-nums` atau `font-mono`.
   - Jangan gunakan hard delete untuk buku atau anggota yang memiliki riwayat transaksi; gunakan mekanisme arsip (`archived_at`).
4. **Verifikasi Wajib**:
   - Jalankan `npx --yes tsx --test lib/domain/library-rules.test.ts`, `npx --yes tsx --test lib/db/integration.test.ts`, `npm run lint`, dan `npm run build` setelah perubahan kode.
