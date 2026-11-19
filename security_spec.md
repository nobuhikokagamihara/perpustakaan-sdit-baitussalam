# Security Specification — Perpustakaan SD Lentera Pustaka (Firestore)

Dokumen ini mendefinisikan invarian keamanan data, matriks "Dirty Dozen" payload serangan, dan jaminan pengujian sebelum deployment aturan Firestore (`firestore.rules`).

## 1. Data Invariants (Invarian Kritis)

1. **Default-Deny Catch-All**: Seluruh path yang tidak dideklarasikan secara eksplisit wajib ditolak (`allow read, write: if false;`).
2. **Email Verification Enforcement**: Seluruh operasi tulis (dan akses role admin/staf) mewajibkan `request.auth != null && request.auth.token.email_verified == true`. Email yang belum terverifikasi dilarang mengakses hak admin meskipun string email cocok.
3. **Zero Self-Assigned Privilege Escalation**:
   - Pengguna biasa yang membuat profil `/users/{uid}` wajib memiliki `role == 'anggota'`, `uid == request.auth.uid`, dan `isActive == true`.
   - Dokumen `/staff_roles/{uid}` hanya dapat dibuat, diubah, atau dihapus oleh `isAdmin()` (Super Admin terverifikasi `nobuhikokagamihara@gmail.com` atau pemegang peran `super_admin`).
4. **PII Isolation (Pemisahan Koleksi Publik vs Pribadi)**:
   - Katalog publik `/public_catalog/{bookId}` **dilarang** menyimpan PII (email, nomor telepon, alamat, NIS/NIP, maupun data internal seperti harga pembelian atau catatan transaksi).
   - Koleksi PII (`/members`, `/users`, `/loans`, `/returns`, `/reservations`, `/fines`, `/payments`) hanya dapat dibaca oleh staf perpustakaan terverifikasi atau pemilik dokumen (`ownerUid == request.auth.uid`).
5. **Path Variable & Payload Size Hardening**:
   - Seluruh document ID path variable wajib memenuhi `isValidId(id)` (`^[a-zA-Z0-9_\\-]+$`, panjang 1–128 karakter).
   - Seluruh field bertipe `string` wajib memiliki validasi `.size() <= MAX`. Seluruh array (`items`) wajib dibatasi ukurannya.
6. **Anti-Update-Gap & Action-Based Updates**:
   - Setiap blok `allow update` wajib diawali `isValid[Entity](incoming())` serta menggunakan `incoming().diff(existing()).affectedKeys().hasOnly([...])` per aksi bisnis spesifik.
   - Field `createdAt`, `numericId`, dan `ownerUid` bersifat immutable setelah dibuat.
7. **Temporal Integrity (`request.time`)**:
   - Seluruh timestamp sistem (`createdAt` saat create, `updatedAt` saat create/update) wajib sama dengan `request.time` (`serverTimestamp()`). Timestamp buatan klien ditolak.
8. **Terminal State Locking & Append-Only Ledgers**:
   - Peminjaman berstatus `'Selesai'` tidak dapat dimodifikasi lagi oleh petugas biasa (override hanya `isAdmin()`).
   - Denda berstatus `'Lunas'` atau `'Dibebaskan'` bersifat terminal dan terkunci.
   - Pengadaan berstatus `'Selesai'` atau `'Ditolak'` serta Stock Opname `'Selesai'` terkunci.
   - Koleksi `/payments`, `/returns`, dan `/audit_logs` bersifat append-only (`allow update, delete: if false;`).
   - Koleksi `/books`, `/public_catalog`, `/members`, `/loans`, `/fines`, `/reading_schedules`, dan `/school_classes` melarang hard delete (`allow delete: if false;`); penonaktifan memakai flag `archived: true` atau status `'Nonaktif'`/`'Dibatalkan'`.
9. **Relational Existence (`existsAfter`)**:
   - Pembuatan `book_copies` wajib memverifikasi `books/$(bookId)` eksis; `loans` wajib memverifikasi `members/$(memberId)` eksis; `returns` wajib memverifikasi `loans/$(loanId)` dan `book_copies/$(copyId)` eksis; `payments` wajib memverifikasi `fines/$(fineId)` eksis.

---

## 2. The "Dirty Dozen" Payloads (12 Uji Penetrasi Wajib Ditolak)

1. **DD-01 — Privilege Escalation on User Creation**:
   `POST /users/attacker_uid` dengan `{"uid":"attacker_uid","email":"siswa@sd.sch.id","fullName":"Attacker","role":"super_admin","isActive":true,"createdAt":"SERVER_TIME","updatedAt":"SERVER_TIME"}` -> **DITOLAK** (`role != 'anggota'`).
2. **DD-02 — Unverified Email Admin Spoof**:
   `request.auth = { uid: "u2", token: { email: "nobuhikokagamihara@gmail.com", email_verified: false } }` mencoba menulis ke `/staff_roles/u2` -> **DITOLAK** (`email_verified != true`).
3. **DD-03 — Ghost Field / Shadow Update**:
   Update `/books/book_1` menyertakan field bayangan `{"isApprovedOverride":true,"title":"Judul Baru","updatedAt":"SERVER_TIME"}` -> **DITOLAK** (`affectedKeys().hasOnly(...)` & `keys().hasOnly(...)`).
4. **DD-04 — Cross-Tenant PII Snooping (`members` GET/LIST)**:
   Siswa A (`uid: "siswa_a"`) mencoba membaca `/members/member_2` (`ownerUid: "siswa_b"`) atau `list /members` tanpa filter `ownerUid == request.auth.uid` -> **DITOLAK**.
5. **DD-05 — Client-Forged Timestamp**:
   `POST /loans/loan_99` menyertakan `"createdAt": "2020-01-01T00:00:00Z"` (bukan `request.time` / `serverTimestamp()`) -> **DITOLAK**.
6. **DD-06 — Path Variable ID Poisoning**:
   Menulis ke `/books/../../etc/passwd` atau string sepanjang 250 karakter sebagai `bookId` -> **DITOLAK** (`isValidId(bookId)`).
7. **DD-07 — Value Poisoning (Oversized 1MB String / Type Confusion)**:
   Mengirim `title: "A".repeat(5000)` atau `price: "gratis"` pada `/books/book_9` -> **DITOLAK** (`title.size() <= 240`, `price is number && price >= 0`).
8. **DD-08 — Terminal State Bypass on Settled Fine**:
   Mengubah `/fines/fine_1` yang sudah berstatus `'Lunas'` kembali menjadi `'Belum Lunas'` oleh pustakawan -> **DITOLAK** (`existing().status in ['Belum Lunas', 'Sebagian']`).
9. **DD-09 — Negative / Zero Fine Payment Fraud**:
   Membuat `/payments/pay_99` dengan `amount: -5000` atau `amount: 0` -> **DITOLAK** (`amount is number && amount > 0`).
10. **DD-10 — Audit Log Tampering / Deletion**:
    `UPDATE` atau `DELETE` pada `/audit_logs/log_1` oleh siapa pun (termasuk staf/admin) -> **DITOLAK** (`allow update, delete: if false;`).
11. **DD-11 — Orphaned Loan Creation**:
    Membuat `/loans/loan_999` dengan `memberId: "nonexistent_member_999"` -> **DITOLAK** (`existsAfter(/databases/$(database)/documents/members/$(incoming().memberId))`).
12. **DD-12 — Hard Delete of Historical Book Record**:
    `DELETE /books/book_1` atau `DELETE /public_catalog/book_1` -> **DITOLAK** (`allow delete: if false;`).

---

## 3. Verifikasi Otomatis

Seluruh aturan di atas diverifikasi oleh `firestore.rules.test.ts` menggunakan `npx --yes tsx --test firestore.rules.test.ts` serta divalidasi sintaks & semantiknya melalui `@firebase/eslint-plugin-security-rules`.
