'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { Button, TextField } from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getDefaultRouteForRole, sanitizeRedirectPath } from '@/lib/auth/redirect';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';
import { IS_FIRESTORE_ONLY_MODE } from '@/lib/firebase/client';

const DEMO_ACCOUNTS = [
  {
    role: 'Super Admin',
    email: 'admin@lenterapustaka.id',
    pass: 'admin123',
    desc: 'Akses penuh: pengaturan, RBAC, backup & seluruh modul.',
  },
  {
    role: 'Kepala Perpustakaan',
    email: 'kepala@lenterapustaka.id',
    pass: 'kepala123',
    desc: 'Persetujuan pengadaan, laporan analitik & pengawasan.',
  },
  {
    role: 'Pustakawan',
    email: 'pustakawan@lenterapustaka.id',
    pass: 'pustaka123',
    desc: 'Sirkulasi peminjaman, pengembalian, buku, anggota & opname.',
  },
  {
    role: 'Siswa / Guru',
    email: 'anggota@lenterapustaka.id',
    pass: 'anggota123',
    desc: 'OPAC sekolah, riwayat pinjaman siswa/guru, denda & reservasi.',
  },
];

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, loginWithCredentials, loginWithGoogle, logout } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const nextParam = searchParams.get('next');

  function getPostLoginTarget(roleSlug: string) {
    const fallback = getDefaultRouteForRole(roleSlug);
    return sanitizeRedirectPath(nextParam, fallback);
  }

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      const fbSession = await loginWithGoogle();
      showToast('success', 'Masuk dengan Google berhasil', `Selamat datang, ${fbSession.fullName}`);
      router.push(getPostLoginTarget(fbSession.roleSlug));
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user') || msg.includes('cancelled-popup-request')) {
        setError('Jendela masuk Google ditutup sebelum selesai. Silakan coba lagi.');
      } else if (msg.includes('popup-blocked')) {
        setError('Pop-up masuk Google diblokir oleh peramban. Izinkan pop-up untuk situs ini.');
      } else if (msg.includes('unauthorized-domain')) {
        setError(
          'Domain ini belum terdaftar pada Firebase Authorized Domains. Gunakan akun lokal sekolah di formulir ini.'
        );
      } else if (msg.includes('operation-not-allowed')) {
        setError(
          'Masuk dengan Google belum diaktifkan di proyek Firebase. Gunakan akun lokal sekolah di formulir ini.'
        );
      } else if (msg.includes('email-not-verified')) {
        setError('Email akun Google Anda belum terverifikasi sehingga tidak dapat masuk.');
      } else if (msg.includes('network-request-failed')) {
        setError('Koneksi ke layanan Google gagal. Periksa internet Anda atau gunakan akun lokal sekolah.');
      } else {
        setError('Gagal masuk dengan akun Google. Pastikan koneksi internet aktif atau gunakan akun lokal sekolah.');
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedIdentifier = email.trim();
    if (!trimmedIdentifier || !password) {
      setError('Email/username dan kata sandi wajib diisi.');
      return;
    }
    setLoading(true);
    try {
      const loggedUser = await loginWithCredentials(trimmedIdentifier, password);
      showToast('success', 'Berhasil masuk', `Selamat datang, ${loggedUser.fullName}`);
      router.push(getPostLoginTarget(loggedUser.roleSlug));
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Terjadi kesalahan jaringan saat mencoba masuk.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F3EE] px-4 py-10 flex flex-col items-center justify-center text-[#1E2433]">
      <div
        className={`w-full grid grid-cols-1 gap-8 items-stretch ${
          IS_FIRESTORE_ONLY_MODE ? 'max-w-lg' : 'max-w-4xl md:grid-cols-2'
        }`}
      >
        {/* Login Form */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
          className="rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8 flex flex-col justify-between"
        >
          <div>
            <Link
              href="/catalog"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C5E64] hover:text-[#1E2433]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Kembali ke Katalog Publik OPAC
            </Link>

            <h1 className="mt-6 font-serif text-2xl font-medium tracking-tight text-[#1E2433]">
              Masuk ke Perpustakaan SD Lentera Pustaka
            </h1>
            <p className="mt-1.5 text-sm text-[#5C5E64]">
              {IS_FIRESTORE_ONLY_MODE
                ? 'Masuk menggunakan akun Google untuk mengakses layanan perpustakaan berbasis Cloud Firestore.'
                : 'Masuk menggunakan Google (Cloud Firestore) atau akun sekolah untuk mengakses layanan perpustakaan.'}
            </p>

            {!authLoading && user && (
              <div className="mt-5 rounded-xl border border-[#DFDCD4] bg-[#F4F3EE] p-3.5 text-xs">
                <div className="flex items-start gap-2.5">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#E56B63]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#1E2433] truncate">
                      Aktif sebagai {user.fullName}
                    </p>
                    <p className="text-[#5C5E64]">
                      Peran: <span className="font-medium text-[#1E2433]">{user.roleName}</span>
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => router.push(getPostLoginTarget(user.roleSlug))}
                      >
                        Lanjut ke Aplikasi
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void logout('/login')}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Keluar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button
                type="button"
                variant="secondary"
                loading={googleLoading}
                onClick={handleGoogleLogin}
                className="w-full border-[#D5D0C5] bg-white hover:bg-[#EFECE3] text-[#1E2433] font-medium"
              >
                <Globe className="h-4 w-4 text-[#E56B63]" />
                Masuk dengan Google (Firebase)
              </Button>
            </div>

            {IS_FIRESTORE_ONLY_MODE ? (
              <>
                <AnimatePresence>
                  {error && (
                    <motion.div
                      role="alert"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                      className="mt-4 rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] px-3 py-2 text-xs text-[#9E352F]"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="mt-5 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE]/80 p-4 text-xs text-[#5C5E64] space-y-1.5">
                  <p className="font-semibold text-[#1E2433]">Akses Berbasis Peran (Cloud Firestore)</p>
                  <p>• Akun Super Admin perdana otomatis menginisialisasi data katalog & jadwal sekolah.</p>
                  <p>• Akun Google Siswa/Guru otomatis terdaftar sebagai anggota aktif untuk meminjam & reservasi.</p>
                </div>
              </>
            ) : (
              <>
                <div className="relative my-5 flex items-center">
                  <div className="flex-grow border-t border-[#E7E4DC]" />
                  <span className="mx-3 shrink-0 text-[11px] uppercase tracking-wider text-[#8A8B90]">
                    atau akun lokal sekolah
                  </span>
                  <div className="flex-grow border-t border-[#E7E4DC]" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <TextField
                    label="Email atau Username"
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contoh: pustakawan@lenterapustaka.id"
                    autoComplete="username"
                  />

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="field-kata-sandi" className="text-xs font-medium text-[#4A4945]">
                      Kata Sandi
                    </label>
                    <div className="relative flex items-center">
                      <input
                        id="field-kata-sandi"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Masukkan kata sandi"
                        autoComplete="current-password"
                        className="h-10 w-full rounded-xl border border-[#E2DFD7] bg-white pl-3.5 pr-10 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                        className="absolute right-2.5 rounded-full p-1 text-[#7B7D82] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        role="alert"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
                        className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] px-3 py-2 text-xs text-[#9E352F]"
                      >
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button type="submit" loading={loading} className="w-full">
                    <KeyRound className="h-4 w-4" />
                    Masuk Sistem
                  </Button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 border-t border-[#EAE7DF] pt-4 text-xs text-[#7B7D82]">
            {IS_FIRESTORE_ONLY_MODE
              ? 'Ditenagai oleh Firebase Auth & Cloud Firestore (mode produksi hemat kuota Spark Free Tier).'
              : 'Mendukung Firebase Auth + Cloud Firestore serta sesi lokal sekolah terenkripsi HMAC-SHA256.'}
          </p>
        </motion.div>

        {/* Role Quick-Fill Accounts (Hybrid / Local Dev Mode Only) */}
        {!IS_FIRESTORE_ONLY_MODE && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: MOTION_DURATION.normal, delay: 0.06, ease: EASE_EDITORIAL }}
          className="rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8"
        >
          <div className="flex items-center gap-2 text-[#1E2433]">
            <ShieldCheck className="h-5 w-5 text-[#E56B63]" />
            <h2 className="font-serif text-base font-semibold">Akun Uji Peran (RBAC)</h2>
          </div>
          <p className="mt-1 text-xs text-[#5C5E64]">
            Pilih salah satu peran di bawah ini untuk mengisi kredensial masuk dan menguji kontrol akses berbasis peran.
          </p>

          <div className="mt-5 space-y-2.5">
            {DEMO_ACCOUNTS.map((acc, idx) => {
              const selected = email.trim().toLowerCase() === acc.email;
              return (
                <motion.button
                  key={acc.email}
                  type="button"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{
                    duration: MOTION_DURATION.normal,
                    delay: getStaggerDelay(idx, 0.04, 0.2),
                    ease: EASE_EDITORIAL,
                  }}
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword(acc.pass);
                    setError('');
                  }}
                  className={`w-full rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#E56B63] bg-[#EFECE3]'
                      : 'border-[#E7E4DC] bg-[#F4F3EE]/70 hover:border-[#E56B63] hover:bg-[#EFECE3]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-sm font-semibold text-[#1E2433]">
                      {acc.role}
                    </span>
                    <span className="font-mono text-xs text-[#E56B63]">{acc.email}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#5C5E64]">{acc.desc}</p>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F4F3EE] px-4 py-10 flex items-center justify-center text-sm text-[#5C5E64]">
          Memuat halaman masuk...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
