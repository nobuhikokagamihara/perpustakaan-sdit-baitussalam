# DEPLOYMENT.md — Panduan Deploy Next.js + Cloud Firestore Gratis (Spark Plan)

Lentera Pustaka telah siap di-deploy ke platform hosting Next.js modern (**Vercel Hobby / Gratis**, **Netlify**, **Cloudflare / VPS Node.js**, atau **Firebase App Hosting**) dengan database **Cloud Firestore Spark Plan (Gratis / Rp 0)** menggunakan **Firebase Client SDK + Hardened Security Rules** (tanpa perlu Firebase Admin SDK / service account berbayar).

---

## 1. Persiapan Firebase Console (Spark Plan — Gratis)

1. Buka [Firebase Console](https://console.firebase.google.com/) dan gunakan proyek existing (`brave-harbor-pwpgt`) atau buat proyek baru pada paket **Spark (Gratis)**.
2. **Aktifkan Authentication**:
   - Masuk ke **Build → Authentication → Sign-in method**.
   - Aktifkan **Google** sebagai penyedia login.
   - Masuk ke **Authentication → Settings → Authorized domains**, lalu tambahkan domain produksi Next.js Anda (misalnya `lentera-pustaka.vercel.app` atau domain kustom sekolah).
3. **Aktifkan Cloud Firestore**:
   - Masuk ke **Build → Firestore Database → Create database**.
   - Pilih region terdekat (misalnya `asia-southeast2` Jakarta atau `asia-southeast1` Singapura).
   - Mulai pada **Production mode** (aturan keamanan akan di-deploy di langkah berikutnya).
   - Pada proyek Spark baru, ID database bawaan adalah `(default)`.

---

## 2. Deploy Aturan Keamanan (`firestore.rules`) & Indeks

1. Jika Anda menggunakan **email Super Admin berbeda** dari bawaan, perbarui email bootstrap pada baris `request.auth.token.email == '...'` di `firestore.rules` dan atur `NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL` ke email yang sama.
2. Instal & login Firebase CLI lalu deploy rules:

```bash
npx firebase-tools login
npx firebase-tools use <PROJECT_ID_ANDA>
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

> **Catatan Indeks**: Seluruh kueri Firestore di Lentera Pustaka dirancang menggunakan indeks kolom tunggal (*single-field index*) bawaan Firestore, sehingga tidak memerlukan composite index tambahan.

---

## 3. Deploy Aplikasi Next.js (Contoh: Vercel Gratis)

1. Push repositori ini ke GitHub / GitLab / Bitbucket.
2. Impor proyek di [Vercel](https://vercel.com/new) (Framework Preset: **Next.js**).
3. Tambahkan **Environment Variables** berikut di pengaturan proyek Vercel:

| Variabel | Nilai Produksi (Firestore Free) | Keterangan |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_DATA_BACKEND` | `firestore` | Menonaktifkan ketergantungan SQLite di SSR/serverless dan mengaktifkan mode produksi Cloud Firestore murni. |
| `NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL` | `email-admin@gmail.com` | Email Google pertama yang otomatis memperoleh peran Super Admin. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | *(dari Firebase Console)* | Opsional jika memakai proyek bawaan `firebase-applet-config.json`. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `<project-id>.firebaseapp.com` | Domain Auth proyek Firebase Anda. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `<project-id>` | ID proyek Firebase Anda. |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `<project-id>.firebasestorage.app` | Bucket proyek Firebase Anda. |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `<sender-id>` | Sender ID Firebase Web App. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `<app-id>` | App ID Firebase Web App. |
| `NEXT_PUBLIC_FIREBASE_DATABASE_ID` | `(default)` | Gunakan `(default)` untuk proyek Spark standar, atau ID named database jika memakai database khusus. |

4. Klik **Deploy**. Build Next.js akan berjalan dengan `npm run build` dan endpoint kesiapan dapat diverifikasi di:
   - `GET https://<domain-anda>/api/health` → mengembalikan `{ "ok": true, "backendMode": "firestore", ... }` tanpa memakai kuota Firestore.

---

## 4. Inisialisasi Data Perdana & Manajemen Peran

1. Buka halaman `/login` pada situs produksi Anda.
2. Klik **Masuk dengan Google (Firebase)** menggunakan akun `NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL`.
3. Saat Super Admin masuk pertama kali, sistem otomatis melakukan **seeding idempoten** ke Cloud Firestore (katalog buku SD, kategori, rak, jenis anggota, 12 jadwal baca kelas 1A–6B, daftar siswa kelas, dan pengaturan sekolah).
4. Untuk menambahkan Pustakawan / Kepala Perpustakaan, masuk ke menu **Pengaturan → Akun Pengguna** dan tambahkan email/UID petugas yang telah login Google.
5. Siswa/Guru yang login dengan akun Google otomatis mendapatkan peran `Siswa / Guru` (`anggota`) dan kartu keanggotaan aktif.

---

## 5. Optimasi Kuota Firestore Free Tier (Spark Plan)

Batas gratis Firestore Spark Plan mencakup **50.000 pembacaan/hari**, **20.000 penulisan/hari**, **20.000 penghapusan/hari**, dan **1 GiB penyimpanan**. Aplikasi ini sudah dilengkapi optimasi bawaan agar tetap jauh di bawah batas gratis untuk operasional sekolah harian:

- **Persistent IndexedDB Multi-Tab Cache**: Dokumen yang sudah dimuat disimpan di cache lokal browser (`persistentLocalCache`) sehingga perpindahan tab/reload menghemat kuota baca.
- **Short-TTL Read Cache + Auto-Invalidation**: Pembacaan berulang antar-halaman di-cache 25 detik di memori dan langsung dibersihkan setiap kali ada transaksi tulis (`POST`/`PUT`/`PATCH`/`DELETE`).
- **Bounded Realtime Notification Listener**: Listener notifikasi dibatasi maksimal 50 dokumen belum terbaca (`where('isRead', '==', false), limit(50)`) agar tidak membaca seluruh riwayat notifikasi.
- **Penanganan Kuota Harian Otomatis**: Jika kuota harian Spark tercapai, sistem mengembalikan pesan informatif yang ramah (HTTP `429`) tanpa merusak tampilan aplikasi.

---

## 6. Menjalankan Produksi di Node.js / VPS (Opsional)

```bash
npm install
npm run build
NEXT_PUBLIC_DATA_BACKEND=firestore npm run start
```

Untuk mode lokal/hybrid dengan SQLite, biarkan `NEXT_PUBLIC_DATA_BACKEND=hybrid` (atau kosong) dan atur `SESSION_SECRET` serta `LIBRARY_DB_PATH` pada volume persisten.
