# DESIGN-SYSTEM.md — Panduan UI/UX Lentera Pustaka

## 1. Token Warna (60-30-10)

- **Canvas Dominan (60%)**: `#F8FAFC` (`bg-slate-50`) dan permukaan kartu `#FFFFFF` (`bg-white`).
- **Struktur & Teks (30%)**: Border hairline `#E2E8F0` (`border-slate-200`), teks utama `#0F172A` (`text-slate-900`), teks sekunder `#475569` (`text-slate-600`), metadata `#64748B` (`text-slate-500`).
- **Aksen Utama (10%)**: Institutional Cobalt `#1D4ED8` (`bg-blue-700`, `text-blue-700`) untuk tombol aksi utama, navigasi aktif, dan fokus input.
- **Warna Semantik** (selalu dipasangkan dengan label teks eksplisit):
  - Tersedia / Aktif / Lunas: `bg-emerald-50 text-emerald-800`
  - Dipinjam / Menunggu / Sebagian: `bg-amber-50 text-amber-800`
  - Terlambat / Diblokir / Rusak / Hilang: `bg-red-50 text-red-800`

## 2. Tipografi & Angka Tabular

- **Display & Judul**: `Plus Jakarta Sans` (500, 600, 700).
- **Body & Tabel**: `DM Sans` (400, 500, 600).
- **Kode, ISBN, Barcode, & Metrik**: `JetBrains Mono` disertai `font-variant-numeric: tabular-nums` (`.tabular-nums`) agar angka sejajar vertikal.

## 3. Spacing, Radius & Elevasi

- **Elevasi Tunggal**: Kartu memakai `border border-slate-200 bg-white` tanpa nesting kartu di dalam kartu.
- **Radius**: `rounded-lg` (`8px`) untuk input, tombol, dan kartu standar; `rounded-xl` (`12px`) untuk modal dan panel utama; `rounded` (`4px`) untuk indikator status.
- **Kontrol Satu Baris**: Semua tombol dan tautan navigasi menggunakan `whitespace-nowrap shrink-0`.

## 4. Komponen Reusable (`/components/ui/DesignPrimitives.tsx`)

- `Button` (`primary`, `secondary`, `danger`, `ghost`), `TextField`, `SelectField`, `SearchField`, `Modal`, `ConfirmDialog`, `StatusIndicator`, `StatCard`, `EmptyState`, `LoadingState`, `ErrorState`, `Pagination`, `QrCodeImage`.
