# SETUP.md — Panduan Setup Lengkap Lentera Pustaka (Next.js + Cloud Firestore Free Tier)

Dokumen ini memandu proses instalasi, konfigurasi **Cloud Firestore Gratis (Spark Plan — Rp 0)**, pengujian lokal, hingga deploy produksi ke platform Next.js (**Vercel**, **Netlify**, **Firebase App Hosting**, atau **VPS Node.js**).

---

## Prasyarat Sistem

Pastikan perangkat Anda sudah memiliki:
- **Node.js 20 LTS atau lebih baru** (rekomendasi: Node.js 22 LTS) — unduh di [nodejs.org](https://nodejs.org/)
- **npm** (otomatis terpasang bersama Node.js)
- **Akun Google** untuk mengakses [Firebase Console](https://console.firebase.google.com/) (paket **Spark / Gratis**, tidak memerlukan kartu kredit)
- **Git** (opsional, untuk push ke GitHub dan deploy otomatis ke Vercel)

Verifikasi instalasi di terminal/Command Prompt:

```bash
node -v
npm -v
```

---

## Opsi A — Setup Otomatis untuk Windows (`setup.bat`)

Jika Anda menggunakan **Windows**, cukup jalankan script otomatisasi yang sudah tersedia di root proyek:

1. Buka folder proyek di File Explorer lalu klik dua kali **`setup.bat`**, atau jalankan lewat Command Prompt / PowerShell:
   ```cmd
   setup.bat
   ```
2. Pilih menu **`[1] Setup Lengkap Otomatis (Rekomendasi)`** untuk menjalankan alur terpandu:
   - Memeriksa versi Node.js & npm secara otomatis.
   - Menjalankan `npm install`.
   - Membuat berkas `.env.local` secara interaktif (pilih mode `firestore` untuk produksi gratis atau `hybrid` untuk pengembangan lokal).
   - (Opsional) Menyelaraskan email Google **Super Admin** perdana di `firestore.rules`.
   - Login Firebase CLI dan deploy `firestore.rules` + `firestore.indexes.json` ke proyek Firebase Spark Anda.
   - Menjalankan tes otomatis, ESLint (termasuk keamanan rules Firestore), dan `npm run build`.
3. Setelah selesai, pilih menu **`[6]`** (`npm run dev`) atau **`[7]`** (`npm run start`) untuk langsung membuka aplikasi di `http://localhost:3000`.

---

## Opsi B — Setup Manual Lengkap (Windows / macOS / Linux)

### Langkah 1 — Instal Dependensi Proyek

```bash
npm install
```

### Langkah 2 — Buat & Siapkan Proyek Firebase (Spark Plan Gratis)

1. Buka [Firebase Console](https://console.firebase.google.com/) → klik **Add project** (atau pilih proyek yang sudah ada).
2. Pastikan paket proyek berada di **Spark Plan (Gratis)**:
   - Kuota gratis harian Firestore: **50.000 pembacaan/hari**, **20.000 penulisan/hari**, **20.000 penghapusan/hari**, **1 GiB penyimpanan**.
3. **Aktifkan Login Google**:
   - Buka **Build → Authentication → Get started**.
   - Pada tab **Sign-in method**, pilih **Google** → aktifkan (*Enable*) → simpan.
   - Buka **Authentication → Settings → Authorized domains** → pastikan `localhost` terdaftar (dan nanti tambahkan domain produksi seperti `nama-app.vercel.app`).
4. **Aktifkan Cloud Firestore**:
   - Buka **Build → Firestore Database → Create database**.
   - Pilih lokasi terdekat, misalnya **`asia-southeast2` (Jakarta)** atau **`asia-southeast1` (Singapura)**.
   - Pilih **Start in production mode** → klik **Create**.
   - Catat ID database Anda (pada proyek Spark baru, default-nya adalah **`(default)`**).
5. **Ambil Konfigurasi Web App**:
   - Buka **Project Settings (ikon gerigi) → General → Your apps → Web (`</>`)**.
   - Daftarkan nama aplikasi (mis. `Lentera Pustaka Web`), lalu salin nilai `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, dan `appId`.

---

### Langkah 3 — Buat Berkas `.env.local`

Salin `.env.example` menjadi `.env.local`:

```bash
# macOS / Linux
cp .env.example .env.local

# Windows (CMD)
copy .env.example .env.local
```

Isi `.env.local` sesuai mode yang Anda inginkan:

#### Mode 1: Produksi Cloud Firestore Murni (Rekomendasi Deploy Serverless / Vercel)

```env
NEXT_PUBLIC_DATA_BACKEND="firestore"
NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL="email-admin-anda@gmail.com"

NEXT_PUBLIC_FIREBASE_API_KEY="AIza..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="project-id-anda.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="project-id-anda"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="project-id-anda.firebasestorage.app"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="1234567890"
NEXT_PUBLIC_FIREBASE_APP_ID="1:1234567890:web:abcdef123456"
NEXT_PUBLIC_FIREBASE_DATABASE_ID="(default)"

APP_URL="http://localhost:3000"
```

#### Mode 2: Hybrid / Pengembangan Lokal (Firestore + Akun Demo SQLite)

```env
NEXT_PUBLIC_DATA_BACKEND="hybrid"
NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL="email-admin-anda@gmail.com"
SESSION_SECRET="ganti-dengan-string-acak-minimal-32-karakter"
LIBRARY_DB_PATH="./data/library.db"
APP_URL="http://localhost:3000"
```

> **Catatan**: Berkas `.env.local` sudah otomatis diabaikan oleh `.gitignore` sehingga kredensial lingkungan lokal tidak akan ter-commit ke Git.

---

### Langkah 4 — Sinkronkan Email Super Admin & Deploy `firestore.rules`

1. Buka `firestore.rules` dan cari fungsi `isAdmin()` (sekitar baris 46):
   ```js
   request.auth.token.email == 'nobuhikokagamihara@gmail.com'
   ```
   Ganti email tersebut dengan email Google Super Admin sekolah Anda (harus **sama persis** dengan `NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL` di `.env.local`).
2. Deploy aturan keamanan & indeks ke Firebase menggunakan `firebase-tools` yang sudah terpasang di proyek:

```bash
npx firebase-tools login
npx firebase-tools use <PROJECT_ID_ANDA>
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

> **Tips**: Jika Anda memakai named database selain `(default)`, tambahkan `"database": "<NAMA_DATABASE_ID>"` di dalam objek `"firestore"` pada `firebase.json` sebelum menjalankan `deploy`.

---

### Langkah 5 — Tes Otomatis, Build & Uji Lokal

Jalankan pemeriksaan kualitas sebelum deploy:

```bash
# 1. Jalankan seluruh unit & integrasi test
npx --yes tsx --test lib/domain/*.test.ts lib/db/*.test.ts lib/auth/*.test.ts lib/motion/*.test.ts lib/firebase/*.test.ts

# 2. Jalankan ESLint (termasuk audit keamanan firestore.rules)
npm run lint

# 3. Build produksi Next.js
npm run build

# 4. Jalankan server produksi lokal di port 3000
npm run start
```

Buka di browser:
- **Status Kesiapan**: `http://localhost:3000/api/health` → harus menampilkan `"ok": true` dan `"firebaseConfigured": true`.
- **Katalog Publik OPAC**: `http://localhost:3000`
- **Halaman Masuk**: `http://localhost:3000/login`

---

### Langkah 6 — Inisialisasi Data Perdana (Auto-Seed ke Firestore)

1. Buka `http://localhost:3000/login` (atau URL produksi setelah deploy).
2. Klik **Masuk dengan Google (Firebase)** menggunakan akun email Super Admin yang sudah Anda daftarkan.
3. Sistem akan otomatis mengisi data awal secara idempoten ke Firestore (katalog buku SD, kategori, rak, jenis keanggotaan, 12 jadwal baca kelas 1A–6B, daftar siswa kelas, dan pengaturan sekolah).
4. Untuk menambahkan staf (**Kepala Perpustakaan** atau **Pustakawan**):
   - Minta staf login Google terlebih dahulu (otomatis masuk sebagai `Siswa / Guru`).
   - Masuk sebagai Super Admin → buka **Pengaturan → Akun Pengguna** → promosikan peran akun tersebut.

---

### Langkah 7 — Deploy Gratis ke Vercel (Next.js + Firestore Spark)

1. Push repositori ini ke GitHub / GitLab / Bitbucket.
2. Masuk ke [vercel.com/new](https://vercel.com/new) → impor repositori Anda (Framework Preset otomatis terdeteksi: **Next.js**).
3. Buka **Project Settings → Environment Variables**, lalu salin seluruh variabel dari `.env.local` (pastikan `NEXT_PUBLIC_DATA_BACKEND` bernilai **`firestore`** dan `APP_URL` diisi domain produksi Vercel Anda).
4. Klik **Deploy**.
5. Setelah mendapatkan domain produksi (mis. `https://lentera-pustaka.vercel.app`), **wajib** tambahkan domain tersebut ke:
   - **Firebase Console → Authentication → Settings → Authorized domains → Add domain** → masukkan `lentera-pustaka.vercel.app`.
6. Verifikasi `https://lentera-pustaka.vercel.app/api/health` dan login perdana dengan akun Super Admin Google Anda.

---

## Pemecahan Masalah (Troubleshooting)

| Gejala / Galat | Penyebab | Solusi |
| :--- | :--- | :--- |
| `auth/unauthorized-domain` saat klik Masuk Google | Domain produksi belum diizinkan di Firebase Auth | Tambahkan domain Anda di **Firebase Console → Authentication → Settings → Authorized domains** |
| `Missing or insufficient permissions` | `firestore.rules` belum di-deploy atau email admin tidak cocok | Pastikan email di `firestore.rules` baris `isAdmin()` cocok dengan `NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL`, lalu jalankan `npx firebase-tools deploy --only firestore:rules` |
| `Quota exceeded` (HTTP `429`) | Batas gratis harian Firestore Spark tercapai | Kuota direset otomatis keesokan harinya; cache lokal IndexedDB & read-cache 25 detik sudah aktif untuk menghemat kuota |
| `Port 3000 is already in use` | Ada proses Node lain di port 3000 | Tutup terminal server sebelumnya atau jalankan dengan `PORT=3001 npm run dev` |
| Katalog publik kosong di mode `firestore` | Data awal belum di-seed oleh Super Admin | Login pertama kali melalui `/login` menggunakan akun Google Super Admin |
