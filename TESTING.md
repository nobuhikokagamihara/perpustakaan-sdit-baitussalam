# TESTING.md — Panduan Pengujian Lentera Pustaka

## 1. Unit Test Aturan Bisnis

Menguji perhitungan jatuh tempo, masa tenggang, denda keterlambatan/kerusakan/kehilangan, validasi peminjaman, perpanjangan, pembayaran parsial/penuh, selisih stock opname, RBAC, dan validasi struktur backup:

```bash
npx --yes tsx --test lib/domain/library-rules.test.ts
```

## 2. Integration Test Database & Transaksi

Menguji skema migrasi SQLite, seeding, unique constraint, transaksi peminjaman atomik, pencegahan peminjaman ganda secara bersamaan, pengembalian + pembentukan denda otomatis + promosi antrean reservasi, pembayaran denda, serta proteksi arsip:

```bash
npx --yes tsx --test lib/db/integration.test.ts
```

## 3. Linting, Typecheck & Build

```bash
npm run lint
npm run build
```

## 4. Pengujian UI & Browser End-to-End

Diverifikasi menggunakan headless Chromium (`playwright-cli`) pada viewport desktop `1440x900` dan mobile `390x844` meliputi:
- Katalog publik OPAC, pencarian, filter, dan detail buku.
- Autentikasi peran (`Pustakawan`, `Super Admin`, `Anggota`).
- Alur penuh peminjaman, perpanjangan, pengembalian, denda, dan persistensi data setelah reload.
