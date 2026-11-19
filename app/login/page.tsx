'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { Button, SelectField, TextField } from '@/components/ui/DesignPrimitives';
import { useAuth } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getDefaultRouteForRole, sanitizeRedirectPath } from '@/lib/auth/redirect';
import { SCHOOL_ROLE_CATALOG } from '@/lib/domain/settings-backup-rules';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';
import { IS_FIRESTORE_ONLY_MODE } from '@/lib/firebase/client';

interface SignupRoleOption {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  requiresApproval: boolean;
}

const FALLBACK_SIGNUP_ROLES: SignupRoleOption[] = SCHOOL_ROLE_CATALOG.filter(
  (r) => r.allowSelfSignup
).map((r, i) => ({
  id: i + 2,
  slug: r.slug,
  name: r.name,
  description: r.description,
  category: r.category,
  requiresApproval: r.requiresApproval,
}));

const DEMO_ACCOUNTS = [
  {
    role: 'Super Admin',
    email: 'admin@lenterapustaka.id',
    pass: 'admin123',
    desc: 'Akses penuh: pengaturan, RBAC, persetujuan akun, backup & seluruh modul.',
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
  const {
    user,
    library,
    loading: authLoading,
    loginWithCredentials,
    signupWithCredentials,
    loginWithGoogle,
    logout,
  } = useAuth();
  const { showToast } = useToast();

  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  const [authTab, setAuthTab] = useState<'login' | 'signup'>(initialMode);

  // Sign-In state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Sign-Up state
  const [roles, setRoles] = useState<SignupRoleOption[]>(FALLBACK_SIGNUP_ROLES);
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupRoleSlug, setSignupRoleSlug] = useState('siswa');
  const [signupUnit, setSignupUnit] = useState('');
  const [signupIdentity, setSignupIdentity] = useState('');
  const [pendingNotice, setPendingNotice] = useState<{
    fullName: string;
    email: string;
    roleName: string;
    message: string;
  } | null>(null);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const nextParam = searchParams.get('next');

  useEffect(() => {
    if (IS_FIRESTORE_ONLY_MODE) return;
    let active = true;
    fetch('/api/auth/signup', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.roles?.length) {
          setRoles(data.roles as SignupRoleOption[]);
        }
      })
      .catch(() => {
        // fallback to FALLBACK_SIGNUP_ROLES
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedSignupRole = useMemo(
    () => roles.find((r) => r.slug === signupRoleSlug) || roles[0] || null,
    [roles, signupRoleSlug]
  );

  const groupedRoles = useMemo(() => {
    const groups = new Map<string, SignupRoleOption[]>();
    for (const r of roles) {
      const cat = r.category || 'Warga Sekolah';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(r);
    }
    return Array.from(groups.entries());
  }, [roles]);

  function getPostLoginTarget(roleSlug: string) {
    const fallback = getDefaultRouteForRole(roleSlug);
    return sanitizeRedirectPath(nextParam, fallback);
  }

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);
    try {
      const requestedRole = authTab === 'signup' ? signupRoleSlug : undefined;
      const fbSession = await loginWithGoogle(requestedRole);
      if (fbSession.approvalStatus === 'pending') {
        showToast(
          'info',
          'Menunggu Persetujuan Super Admin',
          `Akun terdaftar sementara sebagai Siswa/Guru sambil menunggu persetujuan peran ${selectedSignupRole?.name || fbSession.requestedRoleSlug}.`
        );
      } else {
        showToast('success', 'Masuk dengan Google berhasil', `Selamat datang, ${fbSession.fullName}`);
      }
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
      } else if (
        msg.includes('operation-not-allowed') ||
        msg.includes('configuration-not-found') ||
        msg.includes('CONFIGURATION_NOT_FOUND')
      ) {
        setError(
          'Masuk dengan Google belum diaktifkan di proyek Firebase. Silakan buka Firebase Console > Authentication > Sign-in method > aktifkan Google.'
        );
      } else if (msg.includes('email-not-verified')) {
        setError('Email akun Google Anda belum terverifikasi sehingga tidak dapat masuk.');
      } else if (msg.includes('network-request-failed')) {
        setError('Koneksi ke layanan Google gagal. Periksa internet Anda atau gunakan akun lokal sekolah.');
      } else if (msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
        setError(
          'Akses Firestore ditolak (Security Rules belum di-deploy di Firebase Console). Silakan gunakan akun lokal sekolah di formulir bawah ini.'
        );
      } else {
        setError('Gagal masuk dengan akun Google. Pastikan koneksi internet aktif atau gunakan akun lokal sekolah.');
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleLoginSubmit(e: React.FormEvent) {
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

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPendingNotice(null);

    if (!signupFullName.trim() || !signupEmail.trim() || !signupPassword) {
      setError('Nama lengkap, email, dan kata sandi wajib diisi.');
      return;
    }
    if (signupPassword !== signupConfirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      const res = await signupWithCredentials({
        fullName: signupFullName.trim(),
        email: signupEmail.trim(),
        username: signupUsername.trim() || undefined,
        password: signupPassword,
        roleSlug: signupRoleSlug,
        unitOrClass: signupUnit.trim() || undefined,
        identityNumber: signupIdentity.trim() || undefined,
      });

      if (res.pendingApproval) {
        setPendingNotice({
          fullName: signupFullName.trim(),
          email: signupEmail.trim(),
          roleName: selectedSignupRole?.name || signupRoleSlug,
          message: res.message,
        });
        showToast('info', 'Menunggu Persetujuan Super Admin', res.message);
        setSignupPassword('');
        setSignupConfirmPassword('');
      } else {
        showToast('success', 'Pendaftaran berhasil', `Selamat datang, ${res.user.fullName}`);
        router.push(getPostLoginTarget(res.user.roleSlug));
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mendaftarkan akun.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F3EE] px-4 py-10 flex flex-col items-center justify-center text-[#1E2433]">
      <div
        className={`w-full grid grid-cols-1 gap-8 items-stretch ${
          IS_FIRESTORE_ONLY_MODE ? 'max-w-lg' : 'max-w-5xl md:grid-cols-12'
        }`}
      >
        {/* Login / Sign-Up Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
          className={`rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8 flex flex-col justify-between ${
            IS_FIRESTORE_ONLY_MODE ? '' : 'md:col-span-7'
          }`}
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/catalog"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C5E64] hover:text-[#1E2433]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Kembali ke Katalog Publik OPAC
              </Link>

              {/* Auth Tab Switcher */}
              <div className="inline-flex rounded-full border border-[#E2DFD7] bg-[#F4F3EE] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setError('');
                    setPendingNotice(null);
                  }}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    authTab === 'login'
                      ? 'bg-[#222B3A] text-white'
                      : 'text-[#5C5E64] hover:text-[#1E2433]'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('signup');
                    setError('');
                  }}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    authTab === 'signup'
                      ? 'bg-[#222B3A] text-white'
                      : 'text-[#5C5E64] hover:text-[#1E2433]'
                  }`}
                >
                  Daftar Akun
                </button>
              </div>
            </div>

            <h1 className="mt-6 font-serif text-2xl font-medium tracking-tight text-[#1E2433]">
              {authTab === 'login' ? `Masuk ke ${library.name}` : `Daftar Akun Warga Sekolah`}
            </h1>
            <p className="mt-1.5 text-sm text-[#5C5E64]">
              {authTab === 'login'
                ? `${library.tagline ? `${library.tagline}. ` : ''}${
                    IS_FIRESTORE_ONLY_MODE
                      ? 'Masuk menggunakan akun Google untuk mengakses layanan perpustakaan.'
                      : 'Masuk menggunakan Google atau akun lokal sekolah untuk mengakses layanan perpustakaan.'
                  }`
                : 'Pilih peran Anda di sekolah (Siswa, Guru, Wali Kelas, Komite, Staf, Kepala Perpus, atau Kepala Sekolah).'}
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

            {authTab === 'login' ? (
              <>
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

                    <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
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
              </>
            ) : (
              /* SIGN-UP TAB */
              <div className="mt-5 space-y-4">
                {pendingNotice ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-5 space-y-3 text-xs text-amber-950">
                    <div className="flex items-start gap-2.5">
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                      <div className="space-y-1.5">
                        <h2 className="font-serif text-base font-semibold text-amber-950">
                          Menunggu Persetujuan Super Admin
                        </h2>
                        <p>{pendingNotice.message}</p>
                        <div className="rounded-lg border border-amber-200 bg-white/80 p-3 space-y-1">
                          <p>
                            <span className="text-[#5C5E64]">Nama:</span>{' '}
                            <strong>{pendingNotice.fullName}</strong>
                          </p>
                          <p>
                            <span className="text-[#5C5E64]">Email:</span>{' '}
                            <strong className="font-mono">{pendingNotice.email}</strong>
                          </p>
                          <p>
                            <span className="text-[#5C5E64]">Peran Diajukan:</span>{' '}
                            <strong>{pendingNotice.roleName}</strong>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setPendingNotice(null);
                          setAuthTab('login');
                          setEmail(pendingNotice.email);
                        }}
                      >
                        Kembali ke Halaman Masuk
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setPendingNotice(null)}
                      >
                        Daftar Akun Lain
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSignupSubmit} className="space-y-3.5" noValidate>
                    {/* Role Selector */}
                    <SelectField
                      label="Pilih Peran / Jabatan di Sekolah *"
                      value={signupRoleSlug}
                      onChange={(e) => setSignupRoleSlug(e.target.value)}
                    >
                      {groupedRoles.map(([category, items]) => (
                        <optgroup key={category} label={category}>
                          {items.map((r) => (
                            <option key={r.slug} value={r.slug}>
                              {r.name}
                              {r.requiresApproval ? ' — (Menunggu Persetujuan Super Admin)' : ' — (Langsung Aktif)'}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </SelectField>

                    {selectedSignupRole && (
                      <div
                        className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                          selectedSignupRole.requiresApproval
                            ? 'border-amber-200 bg-amber-50/75 text-amber-950'
                            : 'border-emerald-200 bg-emerald-50/75 text-emerald-950'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {selectedSignupRole.requiresApproval ? (
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                          )}
                          <div>
                            <p className="font-semibold">
                              {selectedSignupRole.requiresApproval
                                ? `Peran "${selectedSignupRole.name}" memerlukan persetujuan Super Admin`
                                : `Peran "${selectedSignupRole.name}" langsung aktif`}
                            </p>
                            <p className="mt-0.5 opacity-90">{selectedSignupRole.description}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {IS_FIRESTORE_ONLY_MODE ? (
                      <div className="pt-2 space-y-3">
                        <Button
                          type="button"
                          variant="secondary"
                          loading={googleLoading}
                          onClick={handleGoogleLogin}
                          className="w-full border-[#D5D0C5] bg-white hover:bg-[#EFECE3] text-[#1E2433] font-medium"
                        >
                          <Globe className="h-4 w-4 text-[#E56B63]" />
                          Daftar / Masuk dengan Google (Firebase)
                        </Button>
                        {error && (
                          <div
                            role="alert"
                            className="rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] px-3 py-2 text-xs text-[#9E352F]"
                          >
                            {error}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <TextField
                            label="Nama Lengkap *"
                            value={signupFullName}
                            onChange={(e) => setSignupFullName(e.target.value)}
                            placeholder="Contoh: Ahmad Fauzi"
                            required
                          />
                          <TextField
                            label="Email *"
                            type="email"
                            value={signupEmail}
                            onChange={(e) => setSignupEmail(e.target.value)}
                            placeholder="ahmad@sekolah.sch.id"
                            required
                          />
                          <TextField
                            label="Username (Opsional)"
                            value={signupUsername}
                            onChange={(e) => setSignupUsername(e.target.value)}
                            placeholder="otomatis dari email jika kosong"
                          />
                          <TextField
                            label="Kelas / Unit (Opsional)"
                            value={signupUnit}
                            onChange={(e) => setSignupUnit(e.target.value)}
                            placeholder="Contoh: Kelas 5A / Guru IPA"
                          />
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="signup-pass" className="text-xs font-medium text-[#4A4945]">
                              Kata Sandi * (Min. 8 karakter, huruf &amp; angka)
                            </label>
                            <div className="relative flex items-center">
                              <input
                                id="signup-pass"
                                type={showSignupPassword ? 'text' : 'password'}
                                value={signupPassword}
                                onChange={(e) => setSignupPassword(e.target.value)}
                                placeholder="Minimal 8 karakter"
                                autoComplete="new-password"
                                className="h-10 w-full rounded-xl border border-[#E2DFD7] bg-white pl-3.5 pr-10 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSignupPassword((v) => !v)}
                                aria-label={showSignupPassword ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                                className="absolute right-2.5 rounded-full p-1 text-[#7B7D82] hover:bg-[#EFECE3] cursor-pointer"
                              >
                                {showSignupPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                          <TextField
                            label="Konfirmasi Kata Sandi *"
                            type={showSignupPassword ? 'text' : 'password'}
                            value={signupConfirmPassword}
                            onChange={(e) => setSignupConfirmPassword(e.target.value)}
                            placeholder="Ulangi kata sandi"
                            autoComplete="new-password"
                            required
                          />
                        </div>

                        {signupRoleSlug !== 'pengunjung' && (
                          <TextField
                            label="NIS / NISN / NIP (Opsional)"
                            value={signupIdentity}
                            onChange={(e) => setSignupIdentity(e.target.value)}
                            placeholder="Nomor induk siswa atau pegawai"
                          />
                        )}

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
                          <UserPlus className="h-4 w-4" />
                          {selectedSignupRole?.requiresApproval
                            ? 'Daftar & Ajukan Persetujuan Super Admin'
                            : 'Daftar & Masuk Sekarang'}
                        </Button>
                      </>
                    )}
                  </form>
                )}
              </div>
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
            className="md:col-span-5 rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-8 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center gap-2 text-[#1E2433]">
                <ShieldCheck className="h-5 w-5 text-[#E56B63]" />
                <h2 className="font-serif text-base font-semibold">Akun Uji Peran (RBAC)</h2>
              </div>
              <p className="mt-1 text-xs text-[#5C5E64]">
                Pilih salah satu peran di bawah ini untuk mengisi kredensial masuk dan menguji kontrol akses berbasis peran.
              </p>

              <div className="mt-5 space-y-2.5">
                {DEMO_ACCOUNTS.map((acc, idx) => {
                  const selected = authTab === 'login' && email.trim().toLowerCase() === acc.email;
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
                        setAuthTab('login');
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
            </div>

            <div className="mt-6 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE]/80 p-4 text-xs text-[#5C5E64] space-y-1">
              <p className="font-semibold text-[#1E2433]">Alur Persetujuan Pendaftaran</p>
              <p>
                • Siswa, Guru, Wali Kelas, Duta Literasi, Komite, dan Pengunjung langsung aktif setelah mendaftar.
              </p>
              <p>
                • Admin Perpustakaan, Kepala Perpustakaan, Kepala Sekolah, Pustakawan, TU, dan Bendahara menunggu persetujuan{' '}
                <strong className="text-[#1E2433]">Super Admin</strong> di menu Pengaturan → Akun Pengguna.
              </p>
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
