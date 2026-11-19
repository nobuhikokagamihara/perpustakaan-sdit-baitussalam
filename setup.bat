@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Lentera Pustaka - Otomatisasi Setup (Next.js + Firestore Free Tier)

cd /d "%~dp0"

:CHECK_ENV
cls
echo ============================================================================
echo   LENTERA PUSTAKA - OTOMATISASI SETUP NEXT.JS + CLOUD FIRESTORE FREE TIER
echo ============================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js tidak ditemukan di PATH sistem Anda.
    echo         Silakan unduh dan pasang Node.js 20+ LTS dari https://nodejs.org/
    echo         Lalu tutup dan jalankan kembali setup.bat ini.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm tidak ditemukan. Pastikan instalasi Node.js berjalan normal.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v') do set "NPM_VER=%%v"
echo [OK] Node.js terdeteksi : !NODE_VER!
echo [OK] npm terdeteksi     : v!NPM_VER!
echo [OK] Direktori proyek   : %CD%
echo.

:MAIN_MENU
echo ----------------------------------------------------------------------------
echo  PILIH LANGKAH SETUP:
echo ----------------------------------------------------------------------------
echo   [1] Setup Lengkap Otomatis (Install ^> .env.local ^> Rules ^> Test ^> Build)
echo   [2] Install Dependensi (npm install)
echo   [3] Wizard Konfigurasi .env.local (Firestore Free / Hybrid)
echo   [4] Login Firebase ^& Deploy firestore.rules + firestore.indexes.json
echo   [5] Jalankan Tes Otomatis, Lint ^& Build Produksi
echo   [6] Jalankan Server Pengembangan (npm run dev - Port 3000)
echo   [7] Jalankan Server Produksi (npm run start - Port 3000)
echo   [0] Keluar
echo ----------------------------------------------------------------------------
set "CHOICE="
set /p "CHOICE=Masukkan pilihan Anda [0-7]: "

if "%CHOICE%"=="1" goto FULL_SETUP
if "%CHOICE%"=="2" goto DO_INSTALL
if "%CHOICE%"=="3" goto DO_ENV_WIZARD
if "%CHOICE%"=="4" goto DO_FIREBASE_DEPLOY
if "%CHOICE%"=="5" goto DO_VERIFY
if "%CHOICE%"=="6" goto DO_DEV
if "%CHOICE%"=="7" goto DO_START
if "%CHOICE%"=="0" goto END_SCRIPT

echo.
echo [!] Pilihan tidak dikenali. Silakan masukkan angka 0 sampai 7.
echo.
goto MAIN_MENU

:: ============================================================================
:: [1] SETUP LENGKAP OTOMATIS
:: ============================================================================
:FULL_SETUP
call :SUB_INSTALL
if errorlevel 1 goto AFTER_TASK

call :SUB_ENV_WIZARD
if errorlevel 1 goto AFTER_TASK

echo.
set "DO_FB_NOW="
set /p "DO_FB_NOW=Apakah ingin langsung login ^& deploy firestore.rules ke Firebase sekarang? (Y/n): "
if /i "!DO_FB_NOW!"=="n" goto SKIP_FULL_FB
call :SUB_FIREBASE_DEPLOY
:SKIP_FULL_FB

call :SUB_VERIFY
if errorlevel 1 goto AFTER_TASK

echo.
echo ============================================================================
echo   SETUP LENGKAP SELESAI!
echo   Langkah berikutnya:
echo   - Pilih menu [6] atau [7] untuk menjalankan aplikasi di http://localhost:3000
echo   - Buka /api/health untuk cek status kesiapan
echo   - Login perdana dengan akun Google Super Admin untuk auto-seeding Firestore
echo ============================================================================
goto AFTER_TASK

:: ============================================================================
:: MENU HANDLERS
:: ============================================================================
:DO_INSTALL
call :SUB_INSTALL
goto AFTER_TASK

:DO_ENV_WIZARD
call :SUB_ENV_WIZARD
goto AFTER_TASK

:DO_FIREBASE_DEPLOY
call :SUB_FIREBASE_DEPLOY
goto AFTER_TASK

:DO_VERIFY
call :SUB_VERIFY
goto AFTER_TASK

:DO_DEV
echo.
echo [*] Menjalankan server Next.js Development di http://localhost:3000 ...
echo     Tekan Ctrl+C untuk menghentikan server.
echo.
call npm run dev
goto AFTER_TASK

:DO_START
if exist ".next" goto RUN_PROD_SERVER
echo [!] Folder .next belum ada. Menjalankan npm run build terlebih dahulu...
call npm run build
if errorlevel 1 goto AFTER_TASK
:RUN_PROD_SERVER
echo.
echo [*] Menjalankan server Next.js Produksi di http://localhost:3000 ...
echo     Tekan Ctrl+C untuk menghentikan server.
echo.
call npm run start
goto AFTER_TASK

:AFTER_TASK
echo.
pause
cls
goto MAIN_MENU

:: ============================================================================
:: SUBROUTINE: INSTALL DEPENDENCIES
:: ============================================================================
:SUB_INSTALL
echo.
echo [1/4] Menginstal dependensi npm (npm install)...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install gagal. Periksa koneksi internet Anda lalu coba lagi.
    exit /b 1
)
echo [OK] Seluruh dependensi berhasil dipasang.
exit /b 0

:: ============================================================================
:: SUBROUTINE: WIZARD .env.local & SYNC ADMIN EMAIL
:: ============================================================================
:SUB_ENV_WIZARD
echo.
echo [2/4] Wizard Konfigurasi Lingkungan (.env.local)
echo ----------------------------------------------------------------------------
if not exist ".env.local" goto PROMPT_ENV_VALUES
echo [INFO] File .env.local sudah ada.
set "OVERWRITE_ENV="
set /p "OVERWRITE_ENV=Apakah ingin menimpa .env.local dengan konfigurasi baru? (y/N): "
if /i "!OVERWRITE_ENV!"=="y" goto PROMPT_ENV_VALUES
echo [OK] Mempertahankan .env.local yang sudah ada.
exit /b 0

:PROMPT_ENV_VALUES
echo.
echo Pilih mode backend data:
echo   1 = firestore (Rekomendasi deploy produksi Vercel / Netlify / Spark Free Tier)
echo   2 = hybrid    (Pengembangan lokal: Firestore + akun demo SQLite)
set "MODE_OPT="
set /p "MODE_OPT=Pilihan mode [1/2, default 1]: "
set "DATA_BACKEND=firestore"
if "!MODE_OPT!"=="2" set "DATA_BACKEND=hybrid"

echo.
set "ADMIN_EMAIL="
set /p "ADMIN_EMAIL=Email Google Super Admin perdana [default: nobuhikokagamihara@gmail.com]: "
if "!ADMIN_EMAIL!"=="" set "ADMIN_EMAIL=nobuhikokagamihara@gmail.com"

echo.
echo Konfigurasi Firebase Web SDK:
echo (Kosongkan/tekan Enter untuk memakai konfigurasi bawaan di firebase-applet-config.json)
set "FB_PROJECT_ID="
set "FB_API_KEY="
set "FB_AUTH_DOMAIN="
set "FB_STORAGE_BUCKET="
set "FB_SENDER_ID="
set "FB_APP_ID="
set "FB_DB_ID="

set /p "FB_PROJECT_ID=Firebase Project ID (mis. perpus-sd-anda) [Enter=bawaan]: "
if "!FB_PROJECT_ID!"=="" goto SKIP_CUSTOM_FB

set /p "FB_API_KEY=NEXT_PUBLIC_FIREBASE_API_KEY: "
set /p "FB_AUTH_DOMAIN=NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN [default: !FB_PROJECT_ID!.firebaseapp.com]: "
if "!FB_AUTH_DOMAIN!"=="" set "FB_AUTH_DOMAIN=!FB_PROJECT_ID!.firebaseapp.com"
set /p "FB_STORAGE_BUCKET=NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET [default: !FB_PROJECT_ID!.firebasestorage.app]: "
if "!FB_STORAGE_BUCKET!"=="" set "FB_STORAGE_BUCKET=!FB_PROJECT_ID!.firebasestorage.app"
set /p "FB_SENDER_ID=NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "
set /p "FB_APP_ID=NEXT_PUBLIC_FIREBASE_APP_ID: "
set /p "FB_DB_ID=NEXT_PUBLIC_FIREBASE_DATABASE_ID [default: (default)]: "
if "!FB_DB_ID!"=="" set "FB_DB_ID=(default)"

:SKIP_CUSTOM_FB
echo.
set "APP_PUBLIC_URL="
set /p "APP_PUBLIC_URL=URL aplikasi publik [default: http://localhost:3000]: "
if "!APP_PUBLIC_URL!"=="" set "APP_PUBLIC_URL=http://localhost:3000"

node -e "const fs=require('fs'),crypto=require('crypto'),e=process.env;const lines=['# Dihasilkan otomatis oleh setup.bat - Lentera Pustaka','NEXT_PUBLIC_DATA_BACKEND='+JSON.stringify(e.DATA_BACKEND||'firestore'),'NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL='+JSON.stringify(e.ADMIN_EMAIL||''),'APP_URL='+JSON.stringify(e.APP_PUBLIC_URL||'http://localhost:3000')];if(e.FB_PROJECT_ID){lines.push('NEXT_PUBLIC_FIREBASE_API_KEY='+JSON.stringify(e.FB_API_KEY||''),'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN='+JSON.stringify(e.FB_AUTH_DOMAIN||''),'NEXT_PUBLIC_FIREBASE_PROJECT_ID='+JSON.stringify(e.FB_PROJECT_ID||''),'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET='+JSON.stringify(e.FB_STORAGE_BUCKET||''),'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID='+JSON.stringify(e.FB_SENDER_ID||''),'NEXT_PUBLIC_FIREBASE_APP_ID='+JSON.stringify(e.FB_APP_ID||''),'NEXT_PUBLIC_FIREBASE_DATABASE_ID='+JSON.stringify(e.FB_DB_ID||'(default)'));}lines.push('SESSION_SECRET='+JSON.stringify(crypto.randomBytes(32).toString('hex')),'LIBRARY_DB_PATH=\"./data/library.db\"');fs.writeFileSync('.env.local',lines.join('\n')+'\n','utf8');"
if errorlevel 1 (
    echo [ERROR] Gagal membuat file .env.local.
    exit /b 1
)
echo [OK] File .env.local berhasil dibuat (Mode: !DATA_BACKEND!).

set "SYNC_RULES="
set /p "SYNC_RULES=Sinkronkan email Super Admin (!ADMIN_EMAIL!) ke firestore.rules? (Y/n): "
if /i "!SYNC_RULES!"=="n" goto SKIP_SYNC_RULES
node -e "const fs=require('fs');const email=(process.env.ADMIN_EMAIL||'').trim();let txt=fs.readFileSync('firestore.rules','utf8');const re=/request\.auth\.token\.email == '[^']+'/;if(email && re.test(txt)){txt=txt.replace(re,'request.auth.token.email == \''+email.replace(/'/g,'')+'\'');fs.writeFileSync('firestore.rules',txt,'utf8');console.log('[OK] Email Super Admin di firestore.rules diperbarui ke: '+email);}else{console.log('[WARN] Email tidak berubah.');}"
:SKIP_SYNC_RULES

if "!FB_DB_ID!"=="" goto SKIP_CUSTOM_DB_JSON
if "!FB_DB_ID!"=="(default)" goto SKIP_CUSTOM_DB_JSON
node -e "const fs=require('fs');const dbId=(process.env.FB_DB_ID||'').trim();const cfg=JSON.parse(fs.readFileSync('firebase.json','utf8'));cfg.firestore=cfg.firestore||{};cfg.firestore.database=dbId;fs.writeFileSync('firebase.json',JSON.stringify(cfg,null,2)+'\n','utf8');console.log('[OK] firebase.json diperbarui untuk database: '+dbId);"
:SKIP_CUSTOM_DB_JSON

exit /b 0

:: ============================================================================
:: SUBROUTINE: FIREBASE LOGIN & DEPLOY RULES
:: ============================================================================
:SUB_FIREBASE_DEPLOY
echo.
echo [3/4] Login Firebase CLI ^& Deploy Firestore Rules + Indexes
echo ----------------------------------------------------------------------------
set "TARGET_PROJECT="
if not "!FB_PROJECT_ID!"=="" (
    set "TARGET_PROJECT=!FB_PROJECT_ID!"
) else (
    for /f "delims=" %%p in ('node -e "try{const c=require('./firebase-applet-config.json');console.log(c.projectId||'');}catch(e){console.log('');}"') do set "TARGET_PROJECT=%%p"
)

set "INPUT_PROJECT="
set /p "INPUT_PROJECT=Masukkan Firebase Project ID untuk deploy rules [default: !TARGET_PROJECT!]: "
if not "!INPUT_PROJECT!"=="" set "TARGET_PROJECT=!INPUT_PROJECT!"

if "!TARGET_PROJECT!"=="" (
    echo [ERROR] Firebase Project ID wajib diisi untuk deploy rules.
    exit /b 1
)

echo [*] Memeriksa sesi Firebase CLI (browser akan terbuka jika belum login)...
call npx firebase-tools login
if errorlevel 1 (
    echo [ERROR] Login Firebase gagal atau dibatalkan.
    exit /b 1
)

echo [*] Menargetkan proyek Firebase: !TARGET_PROJECT!
call npx firebase-tools use "!TARGET_PROJECT!"
if errorlevel 1 (
    echo [ERROR] Gagal memilih proyek !TARGET_PROJECT!. Pastikan Project ID benar dan akun Anda memiliki akses.
    exit /b 1
)

echo [*] Mengunggah firestore.rules dan firestore.indexes.json ...
call npx firebase-tools deploy --only firestore:rules,firestore:indexes
if errorlevel 1 (
    echo [ERROR] Deploy Firestore rules gagal. Pastikan Cloud Firestore sudah diaktifkan di Firebase Console.
    exit /b 1
)

echo [OK] firestore.rules dan firestore.indexes.json berhasil di-deploy ke !TARGET_PROJECT!.
exit /b 0

:: ============================================================================
:: SUBROUTINE: TEST, LINT & BUILD
:: ============================================================================
:SUB_VERIFY
echo.
echo [4/4] Menjalankan Tes Otomatis, Lint ^& Build Produksi Next.js
echo ----------------------------------------------------------------------------

echo [*] Menjalankan unit ^& integrasi test...
call npx --yes tsx --test lib/domain/*.test.ts lib/db/*.test.ts lib/auth/*.test.ts lib/motion/*.test.ts lib/firebase/*.test.ts
if errorlevel 1 (
    echo [ERROR] Terdapat unit/integrasi test yang gagal!
    exit /b 1
)

echo [*] Menjalankan ESLint (kode ^& keamanan firestore.rules)...
call npm run lint
if errorlevel 1 (
    echo [ERROR] Pemeriksaan ESLint menemukan galat!
    exit /b 1
)

echo [*] Menjalankan Next.js Production Build (npm run build)...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build produksi Next.js gagal!
    exit /b 1
)

echo [OK] Seluruh tes, lint, dan build produksi lulus 100%%!
exit /b 0

:END_SCRIPT
echo.
echo Sampai jumpa! Terima kasih telah menggunakan Lentera Pustaka.
echo.
endlocal
exit /b 0
