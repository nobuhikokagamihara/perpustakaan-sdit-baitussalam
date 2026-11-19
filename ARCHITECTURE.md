# ARCHITECTURE.md — Arsitektur Sistem Lentera Pustaka

## 1. Tinjauan Stack Teknologi

- **Frontend & Backend**: Next.js 15 App Router (React 19, TypeScript)
- **Styling**: Tailwind CSS v4 dengan token font `Plus Jakarta Sans`, `DM Sans`, dan `JetBrains Mono`
- **Database**: SQLite (`better-sqlite3`) dalam mode `WAL` dengan `foreign_keys = ON`
- **Autentikasi**: Sesi berbasis cookie HTTP-only bertanda tangan HMAC-SHA256 dan hashing kata sandi `crypto.scryptSync`
- **Utilitas**: `qrcode` (label & kartu QR), `xlsx` (import/export Excel & CSV), `jspdf` + `jspdf-autotable` (export PDF)

## 2. Struktur Direktori

- `/app/` — Halaman App Router (`page.tsx`, `catalog/`, `books/`, `members/`, `loans/`, `returns/`, `reservations/`, `fines/`, `inventory/`, `acquisitions/`, `reports/`, `notifications/`, `settings/`, `login/`) dan API Routes (`/app/api/*`).
- `/components/layout/` — `AppShell.tsx` (sidebar RBAC, top bar, dan portal OPAC publik).
- `/components/ui/` — `DesignPrimitives.tsx`, `AuthProvider.tsx`, `ToastProvider.tsx`.
- `/components/dashboard/` — `DashboardView.tsx` dan `DashboardCharts.tsx`.
- `/lib/domain/` — Aturan bisnis murni dan unit test (`library-rules.ts`, `library-rules.test.ts`).
- `/lib/db/` — Koneksi singleton SQLite, migrasi terkontrol, seeding deterministik, dan helper audit log.
- `/lib/auth/` — Kriptografi sesi, rate limiter, dan middleware RBAC `requirePermission`.
- `/lib/client/` — Ekspor CSV, Excel, PDF, dan parser spreadsheet.

## 3. Alur Request & Transaksi

1. Klien mengirim request ke `/app/api/*` dengan cookie sesi `lentera_session`.
2. Route handler memvalidasi sesi dan izin RBAC via `requirePermission()`.
3. Input divalidasi dan diproses menggunakan fungsi murni dari `/lib/domain/library-rules.ts`.
4. Mutasi multi-tabel dijalankan atomik dalam `db.transaction(() => { ... })` dan dicatat ke `audit_logs`.
