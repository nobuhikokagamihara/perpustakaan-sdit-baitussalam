# DATABASE.md — Skema & Relasi Database

Database menggunakan SQLite relasional (`data/library.db`) dengan `PRAGMA foreign_keys = ON` dan migrasi terkontrol di `/lib/db/schema.ts`.

## Kelompok Tabel Utama

1. **RBAC & Akun**: `roles`, `permissions`, `role_permissions`, `users`.
2. **Keanggotaan**: `membership_types`, `members` (`member_code UNIQUE`, `archived_at` soft delete).
3. **Bibliografi & Eksemplar**: `authors`, `publishers`, `categories`, `books` (`isbn UNIQUE`, `archived_at`), `book_authors`, `book_categories`, `locations`, `shelves` (`code UNIQUE`), `book_copies` (`inventory_code UNIQUE`, `barcode UNIQUE`, `archived_at`).
4. **Sirkulasi**: `loans` (`loan_number UNIQUE`, `idempotency_key UNIQUE`), `loan_items`, `loan_renewals`, `returns` (`return_number UNIQUE`).
5. **Reservasi & Denda**: `reservations` (`reservation_number UNIQUE`), `fines` (`fine_number UNIQUE`), `payments` (`payment_number UNIQUE`).
6. **Pengadaan & Inventaris**: `suppliers`, `acquisitions`, `acquisition_items`, `inventory_audits`, `inventory_audit_items`.
7. **Sistem**: `notifications`, `library_settings`, `audit_logs`, `migrations`.

## Integritas & Indeks

- Unique constraints pada `member_code`, `isbn`, `inventory_code`, `barcode`, `loan_number`, `idempotency_key`, `return_number`, `fine_number`, dan `payment_number`.
- Index pencarian pada `books(title)`, `books(isbn)`, `book_copies(barcode)`, `book_copies(status)`, `members(member_code)`, `loans(member_id)`, `reservations(book_id, status)`, dan `audit_logs(entity_type, created_at)`.
