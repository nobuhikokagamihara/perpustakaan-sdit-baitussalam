'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogOut,
  RefreshCw,
  School,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { Button, SelectField, TextField } from '@/components/ui/DesignPrimitives';
import { useAuth, type PendingRegistrationInfo } from '@/components/ui/AuthProvider';
import { useToast } from '@/components/ui/ToastProvider';
import { getDefaultRouteForRole, sanitizeRedirectPath } from '@/lib/auth/redirect';
import { SCHOOL_ROLE_CATALOG } from '@/lib/domain/settings-backup-rules';
import { SD_CLASSES } from '@/lib/domain/reading-schedule-rules';
import {
  detectClassTeacherConflict,
  getRoleSignupConfig,
  isPlaceholderTeacherName,
  normalizeTeacherDisplay,
  validateRoleSpecificSignupFields,
  type PublicClassOption,
} from '@/lib/domain/signup-rules';
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

const FALLBACK_CLASSES: PublicClassOption[] = SD_CLASSES.map((c, idx) => ({
  id: idx + 1,
  className: c.className,
  gradeLevel: c.gradeLevel,
  homeroomTeacher: normalizeTeacherDisplay(c.homeroomTeacher),
  companionTeacher: normalizeTeacherDisplay(c.companionTeacher),
  hasHomeroomTeacher: !isPlaceholderTeacherName(c.homeroomTeacher),
  hasCompanionTeacher: !isPlaceholderTeacherName(c.companionTeacher),
  studentCount: c.studentCount,
}));

const DEMO_ACCOUNTS = [
  {
    role: 'Super Admin',
    email: 'admin@lenterapustaka.id',
    pass: 'admin123',
    desc: 'Akses penuh: pengaturan, RBAC, resolusi konflik akun, backup & seluruh modul.',
  },
  {
    role: 'Kepala Perpustakaan',
    email: 'kepala@lenterapustaka.id',
    pass: 'kepala123',
    desc: 'Persetujuan akun/konflik wali kelas, pengadaan, laporan analitik & pengawasan.',
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

function buildDefaultExtraMeta(roleSlug: string): Record<string, string> {
  const cfg = getRoleSignupConfig(roleSlug);
  const next: Record<string, string> = {};
  for (const field of cfg.extraFields) {
    if (field.defaultValue) {
      next[field.key] = field.defaultValue;
    }
  }
  return next;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    user,
    pendingRegistration,
    library,
    loading: authLoading,
    loginWithCredentials,
    signupWithCredentials,
    loginWithGoogle,
    logout,
    refreshSession,
    clearPendingRegistration,
  } = useAuth();
  const { showToast } = useToast();

  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  const [authTab, setAuthTab] = useState<'login' | 'signup'>(initialMode);

  // Sign-In state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Status Checker state (for users returning after closing browser)
  const [showStatusCheck, setShowStatusCheck] = useState(false);
  const [statusQuery, setStatusQuery] = useState('');
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusLookupResult, setStatusLookupResult] = useState<{
    found: boolean;
    message?: string;
    request?: {
      requestCode: string;
      status: string;
      roleName: string;
      assignedClass: string;
      hasConflict: boolean;
      conflictSummary: string;
      decisionNote: string;
      reviewedByName: string;
    };
  } | null>(null);

  // Sign-Up state
  const [roles, setRoles] = useState<SignupRoleOption[]>(FALLBACK_SIGNUP_ROLES);
  const [classes, setClasses] = useState<PublicClassOption[]>(FALLBACK_CLASSES);
  const [signupFullName, setSignupFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupRoleSlug, setSignupRoleSlug] = useState('siswa');
  const [signupClass, setSignupClass] = useState('');
  const [signupGender, setSignupGender] = useState<'L' | 'P' | ''>('L');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupIdentity, setSignupIdentity] = useState('');
  const [signupExtraMeta, setSignupExtraMeta] = useState<Record<string, string>>(() =>
    buildDefaultExtraMeta('siswa')
  );
  const [pendingNotice, setPendingNotice] = useState<PendingRegistrationInfo | null>(null);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const nextParam = searchParams.get('next');

  // Load roles & existing classes
  useEffect(() => {
    let active = true;
    if (IS_FIRESTORE_ONLY_MODE) {
      import('@/lib/firebase/library-store')
        .then((mod) => mod.fetchFirestorePublicClasses())
        .then((cls) => {
          if (active && cls.length > 0) setClasses(cls);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }

    fetch('/api/auth/signup', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.roles?.length) setRoles(data.roles as SignupRoleOption[]);
        if (data.classes?.length) setClasses(data.classes as PublicClassOption[]);
      })
      .catch(() => {
        // keep fallbacks
      });
    return () => {
      active = false;
    };
  }, []);

  const activePending = pendingNotice || pendingRegistration;

  const selectedSignupRole = useMemo(
    () => roles.find((r) => r.slug === signupRoleSlug) || roles[0] || null,
    [roles, signupRoleSlug]
  );

  const roleConfig = useMemo(() => getRoleSignupConfig(signupRoleSlug), [signupRoleSlug]);

  const selectedClassObj = useMemo(
    () => classes.find((c) => c.className === signupClass) || null,
    [classes, signupClass]
  );

  const liveTeacherConflict = useMemo(() => {
    if (!signupClass || (signupRoleSlug !== 'wali_kelas' && signupRoleSlug !== 'guru_pendamping')) {
      return null;
    }
    return detectClassTeacherConflict({
      roleSlug: signupRoleSlug,
      selectedClass: signupClass,
      applicantFullName: signupFullName || 'Pendaftar Baru',
      classRecord: selectedClassObj
        ? {
            className: selectedClassObj.className,
            homeroomTeacher: selectedClassObj.homeroomTeacher,
            companionTeacher: selectedClassObj.companionTeacher,
          }
        : null,
    });
  }, [signupRoleSlug, signupClass, signupFullName, selectedClassObj]);

  const groupedRoles = useMemo(() => {
    const groups = new Map<string, SignupRoleOption[]>();
    for (const r of roles) {
      const cat = r.category || 'Warga Sekolah';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(r);
    }
    return Array.from(groups.entries());
  }, [roles]);

  function handleRoleChange(nextSlug: string) {
    setSignupRoleSlug(nextSlug);
    setSignupClass('');
    setSignupExtraMeta(buildDefaultExtraMeta(nextSlug));
    setError('');
  }

  function getPostLoginTarget(roleSlug: string) {
    const fallback = getDefaultRouteForRole(roleSlug);
    return sanitizeRedirectPath(nextParam, fallback);
  }

  async function handleCheckStatus(e: React.FormEvent) {
    e.preventDefault();
    const q = statusQuery.trim();
    if (!q) return;
    setStatusChecking(true);
    setStatusLookupResult(null);
    try {
      const param = q.includes('@')
        ? `checkEmail=${encodeURIComponent(q)}`
        : `checkCode=${encodeURIComponent(q)}`;
      const res = await fetch(`/api/auth/signup?${param}`, { cache: 'no-store' });
      const data = await res.json();
      setStatusLookupResult(data);
    } catch {
      setStatusLookupResult({ found: false, message: 'Gagal memeriksa status pendaftaran.' });
    } finally {
      setStatusChecking(false);
    }
  }

  async function handleGoogleLogin(isSignupFlow = false) {
    setError('');

    if (isSignupFlow) {
      const check = validateRoleSpecificSignupFields(
        {
          roleSlug: signupRoleSlug,
          fullName: signupFullName.trim() || 'Pengguna Google',
          assignedClass: signupClass,
          identityNumber: signupIdentity,
          gender: roleConfig.showGenderField ? signupGender : '',
          phone: signupPhone,
          extraMeta: signupExtraMeta,
        },
        classes.map((c) => c.className)
      );
      if (!check.valid) {
        setError(check.error || 'Lengkapi data khusus peran terlebih dahulu.');
        return;
      }
    }

    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle(
        isSignupFlow
          ? {
              roleSlug: signupRoleSlug,
              fullName: signupFullName.trim() || undefined,
              assignedClass: signupClass || undefined,
              identityNumber: signupIdentity.trim() || undefined,
              gender: roleConfig.showGenderField ? signupGender : undefined,
              phone: signupPhone.trim() || undefined,
              extraMeta: signupExtraMeta,
            }
          : undefined
      );

      if (result.pendingApproval && result.pendingRegistration) {
        setPendingNotice(result.pendingRegistration);
        setAuthTab('signup');
        showToast(
          'info',
          result.pendingRegistration.status === 'rejected'
            ? 'Pendaftaran Ditolak'
            : 'Status Pending Tersimpan di Firestore',
          result.message || 'Menunggu keputusan Super Admin / Admin / Kepala Perpustakaan.'
        );
        return;
      }

      if (result.user) {
        showToast(
          'success',
          'Masuk dengan Google berhasil',
          result.syncSummary || `Selamat datang, ${result.user.fullName}`
        );
        router.push(getPostLoginTarget(result.user.roleSlug));
        router.refresh();
      }
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
          'Akses Firestore ditolak. Pastikan aturan keamanan Firestore terbaru sudah terpasang atau gunakan akun lokal sekolah.'
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

    const roleCheck = validateRoleSpecificSignupFields(
      {
        roleSlug: signupRoleSlug,
        fullName: signupFullName.trim(),
        assignedClass: signupClass,
        identityNumber: signupIdentity,
        gender: roleConfig.showGenderField ? signupGender : '',
        phone: signupPhone,
        extraMeta: signupExtraMeta,
      },
      classes.map((c) => c.className)
    );

    if (!roleCheck.valid) {
      setError(roleCheck.error || 'Data khusus peran belum lengkap.');
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
        assignedClass: signupClass || undefined,
        unitOrClass: roleCheck.normalizedUnitOrClass || undefined,
        identityNumber: signupIdentity.trim() || undefined,
        gender: roleConfig.showGenderField ? signupGender : undefined,
        phone: signupPhone.trim() || undefined,
        extraMeta: signupExtraMeta,
      });

      if (res.pendingApproval) {
        setPendingNotice({
          requestCode: res.requestCode || '',
          fullName: signupFullName.trim(),
          email: signupEmail.trim(),
          requestedRoleSlug: signupRoleSlug,
          requestedRoleName: selectedSignupRole?.name || signupRoleSlug,
          assignedClass: signupClass,
          hasConflict: Boolean(res.hasConflict),
          conflictType: res.conflictInfo?.conflictType || '',
          conflictExistingValue: res.conflictInfo?.existingValue || '',
          conflictSummary: res.conflictInfo?.summary || res.message,
          status: 'pending',
          source: 'local',
        });
        showToast(
          'info',
          res.hasConflict ? 'Konflik Data — Menunggu Persetujuan' : 'Menunggu Persetujuan',
          res.message
        );
        setSignupPassword('');
        setSignupConfirmPassword('');
      } else if (res.user) {
        showToast(
          'success',
          'Pendaftaran berhasil',
          res.syncSummary || `Selamat datang, ${res.user.fullName}`
        );
        router.push(getPostLoginTarget(res.user.roleSlug));
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mendaftarkan akun.');
    } finally {
      setLoading(false);
    }
  }

  const willRequireApproval =
    Boolean(selectedSignupRole?.requiresApproval) || Boolean(liveTeacherConflict?.hasConflict);

  return (
    <div className="min-h-screen bg-[#F4F3EE] px-4 py-10 flex flex-col items-center justify-center text-[#1E2433]">
      <div
        className={`w-full grid grid-cols-1 gap-8 items-stretch ${
          IS_FIRESTORE_ONLY_MODE ? 'max-w-xl' : 'max-w-5xl md:grid-cols-12'
        }`}
      >
        {/* Login / Sign-Up Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
          className={`rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-6 sm:p-8 flex flex-col justify-between ${
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
                : 'Formulir otomatis menyesuaikan kebutuhan peran Anda (Siswa, Wali Kelas, Guru Pendamping, Guru Mapel, Komite, Staf, dan Pimpinan).'}
            </p>

            {/* Active Session Notice */}
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

            {/* Persisted Pending / Rejected Registration Banner (Survives Browser Close) */}
            {!user && activePending && (
              <div
                className={`mt-5 rounded-xl border p-5 space-y-3 text-xs ${
                  activePending.status === 'rejected'
                    ? 'border-[#F2C6C3] bg-[#FDF2F1] text-[#7A231E]'
                    : 'border-amber-300 bg-amber-50/90 text-amber-950'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {activePending.status === 'rejected' ? (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#C94A43]" />
                  ) : (
                    <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-serif text-base font-semibold">
                        {activePending.status === 'rejected'
                          ? 'Pendaftaran Ditolak — Akun Tidak Disimpan'
                          : activePending.hasConflict
                            ? 'Konflik Data — Status Pending Menunggu Persetujuan'
                            : 'Pendaftaran Berstatus Pending'}
                      </h2>
                      {activePending.requestCode && (
                        <span className="rounded-md border border-current/20 bg-white/80 px-2 py-0.5 font-mono text-[11px] font-semibold">
                          {activePending.requestCode}
                        </span>
                      )}
                    </div>

                    <p className="leading-relaxed">
                      {activePending.status === 'rejected'
                        ? activePending.decisionNote ||
                          'Permintaan pembuatan akun Anda ditolak oleh pengelola sehingga akun tidak disimpan dan data kelas tidak diubah.'
                        : activePending.conflictSummary ||
                          'Permintaan akun Anda sedang ditinjau oleh Super Admin / Admin Perpustakaan / Kepala Perpustakaan.'}
                    </p>

                    <div className="rounded-lg border border-current/15 bg-white/85 p-3 space-y-1 text-[#1E2433]">
                      <p>
                        <span className="text-[#5C5E64]">Nama Pendaftar:</span>{' '}
                        <strong>{activePending.fullName}</strong>
                      </p>
                      <p>
                        <span className="text-[#5C5E64]">Email:</span>{' '}
                        <strong className="font-mono">{activePending.email}</strong>
                      </p>
                      <p>
                        <span className="text-[#5C5E64]">Peran Diajukan:</span>{' '}
                        <strong>{activePending.requestedRoleName}</strong>
                        {activePending.assignedClass && (
                          <>
                            {' '}· Kelas: <strong>{activePending.assignedClass}</strong>
                          </>
                        )}
                      </p>
                      {activePending.conflictExistingValue && (
                        <p className="text-amber-900">
                          <span className="text-[#5C5E64]">Data Terdaftar Saat Ini:</span>{' '}
                          <strong>{activePending.conflictExistingValue}</strong>
                        </p>
                      )}
                      <p>
                        <span className="text-[#5C5E64]">Status Tersimpan:</span>{' '}
                        <strong className="uppercase">
                          {activePending.status === 'pending'
                            ? activePending.source === 'firestore'
                              ? 'PENDING (Cloud Firestore)'
                              : 'PENDING (Tersimpan Permanen)'
                            : 'DITOLAK (Tidak Tersimpan)'}
                        </strong>
                      </p>
                    </div>

                    {activePending.status === 'pending' && (
                      <p className="text-[11px] opacity-90">
                        Anda dapat menutup browser atau keluar dengan aman sekarang. Data pendaftaran
                        berstatus <strong>Pending</strong> tetap tersimpan dan dapat dicek kembali
                        kapan saja. Akun baru akan aktif otomatis setelah disetujui.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {activePending.source === 'firestore' && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void refreshSession()}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Periksa Status Terbaru
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPendingNotice(null);
                      clearPendingRegistration();
                      setAuthTab('login');
                      setEmail(activePending.email);
                    }}
                  >
                    Ke Halaman Masuk
                  </Button>
                  {activePending.source === 'firestore' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void logout('/login')}
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Keluar dari Sesi Google
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setPendingNotice(null);
                        clearPendingRegistration();
                      }}
                    >
                      Daftar Akun Lain
                    </Button>
                  )}
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
                    onClick={() => void handleGoogleLogin(false)}
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
                      <p>• Jika mendaftar pertama kali (Siswa, Wali Kelas, Guru Pendamping, atau Staf), buka tab <strong>Daftar Akun</strong> untuk memilih peran dan kelas terlebih dahulu.</p>
                      <p>• Pendaftaran yang memiliki konflik data atau butuh verifikasi disimpan di Firestore dengan status <strong>Pending</strong> sehingga aman meski browser ditutup.</p>
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

                    {/* Pending Status Lookup for Returning Users */}
                    <div className="mt-5 border-t border-[#EAE7DF] pt-4">
                      <button
                        type="button"
                        onClick={() => setShowStatusCheck((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5C5E64] hover:text-[#1E2433] cursor-pointer"
                      >
                        <Search className="h-3.5 w-3.5 text-[#E56B63]" />
                        {showStatusCheck
                          ? 'Tutup Pengecekan Status Pendaftaran'
                          : 'Sudah mendaftar? Cek Status Pendaftaran Pending'}
                      </button>

                      {showStatusCheck && (
                        <form onSubmit={handleCheckStatus} className="mt-3 space-y-2.5">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={statusQuery}
                              onChange={(e) => setStatusQuery(e.target.value)}
                              placeholder="Masukkan email atau kode REG-..."
                              className="h-9 flex-1 rounded-xl border border-[#E2DFD7] bg-white px-3 text-xs text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none"
                            />
                            <Button type="submit" size="sm" loading={statusChecking}>
                              Cek Status
                            </Button>
                          </div>

                          {statusLookupResult && (
                            <div
                              className={`rounded-xl border px-3 py-2.5 text-xs ${
                                !statusLookupResult.found
                                  ? 'border-[#E7E4DC] bg-[#F4F3EE] text-[#5C5E64]'
                                  : statusLookupResult.request?.status === 'approved'
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                                    : statusLookupResult.request?.status === 'rejected'
                                      ? 'border-[#F2C6C3] bg-[#FDF2F1] text-[#9E352F]'
                                      : 'border-amber-200 bg-amber-50 text-amber-950'
                              }`}
                            >
                              {!statusLookupResult.found ? (
                                <p>{statusLookupResult.message}</p>
                              ) : statusLookupResult.request ? (
                                <div className="space-y-1">
                                  <p className="font-semibold">
                                    {statusLookupResult.request.requestCode} ·{' '}
                                    {statusLookupResult.request.status === 'pending'
                                      ? 'Masih Pending (Menunggu Persetujuan)'
                                      : statusLookupResult.request.status === 'approved'
                                        ? 'Disetujui — Silakan Masuk dengan Akun Anda'
                                        : 'Ditolak — Akun Tidak Disimpan'}
                                  </p>
                                  <p>
                                    Peran: <strong>{statusLookupResult.request.roleName}</strong>
                                    {statusLookupResult.request.assignedClass && (
                                      <> · Kelas: <strong>{statusLookupResult.request.assignedClass}</strong></>
                                    )}
                                  </p>
                                  {statusLookupResult.request.decisionNote && (
                                    <p>Catatan: {statusLookupResult.request.decisionNote}</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </form>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              /* SIGN-UP TAB */
              !activePending && (
                <div className="mt-5 space-y-4">
                  <form onSubmit={handleSignupSubmit} className="space-y-4" noValidate>
                    {/* 1. Role Selector */}
                    <SelectField
                      label="Pilih Peran / Jabatan di Sekolah *"
                      value={signupRoleSlug}
                      onChange={(e) => handleRoleChange(e.target.value)}
                    >
                      {groupedRoles.map(([category, items]) => (
                        <optgroup key={category} label={category}>
                          {items.map((r) => (
                            <option key={r.slug} value={r.slug}>
                              {r.name}
                              {r.requiresApproval
                                ? ' — (Menunggu Persetujuan)'
                                : r.slug === 'wali_kelas' || r.slug === 'guru_pendamping'
                                  ? ' — (Sinkron Kelas Otomatis / Cek Konflik)'
                                  : ' — (Langsung Aktif)'}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </SelectField>

                    {/* Role Hint Banner */}
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
                                ? `Peran "${selectedSignupRole.name}" memerlukan persetujuan Super Admin / Admin / Kepala Perpus`
                                : `Peran "${selectedSignupRole.name}" — ${roleConfig.categoryLabel}`}
                            </p>
                            <p className="mt-0.5 opacity-90">{roleConfig.summaryHint}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 2. Role-Adapted Section (Classes Dropdown + Tailored Fields) */}
                    <div className="rounded-xl border border-[#E7E4DC] bg-[#F4F3EE]/60 p-4 space-y-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1E2433]">
                        <School className="h-3.5 w-3.5 text-[#E56B63]" />
                        Data Khusus Peran: {selectedSignupRole?.name || signupRoleSlug}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {/* Existing Classes Dropdown for Siswa, Duta Literasi, Wali Kelas, Guru Pendamping, Komite */}
                        {roleConfig.requiresClassDropdown && (
                          <SelectField
                            label={`${roleConfig.classDropdownLabel}${roleConfig.classDropdownOptional ? '' : ' *'}`}
                            value={signupClass}
                            onChange={(e) => setSignupClass(e.target.value)}
                            className="sm:col-span-2"
                          >
                            <option value="">
                              {roleConfig.classDropdownOptional
                                ? '-- Tidak memilih kelas tertentu --'
                                : '-- Pilih Kelas yang Sudah Ada --'}
                            </option>
                            {classes.map((cls) => {
                              let suffix = ` (Tingkat ${cls.gradeLevel})`;
                              if (signupRoleSlug === 'wali_kelas') {
                                suffix = cls.hasHomeroomTeacher
                                  ? ` — Wali saat ini: ${cls.homeroomTeacher} (Konflik · Perlu Persetujuan)`
                                  : ' — Slot Wali Kelas Kosong (Langsung Sinkron)';
                              } else if (signupRoleSlug === 'guru_pendamping') {
                                suffix = cls.hasCompanionTeacher
                                  ? ` — Pendamping saat ini: ${cls.companionTeacher} (Konflik · Perlu Persetujuan)`
                                  : ' — Slot Pendamping Kosong (Langsung Sinkron)';
                              }
                              return (
                                <option key={cls.className} value={cls.className}>
                                  {cls.className}
                                  {suffix}
                                </option>
                              );
                            })}
                          </SelectField>
                        )}

                        {/* Real-time Conflict vs Direct Sync Indicator for Wali Kelas & Guru Pendamping */}
                        {liveTeacherConflict && (
                          <div
                            className={`sm:col-span-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                              liveTeacherConflict.hasConflict
                                ? 'border-amber-300 bg-amber-50 text-amber-950'
                                : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {liveTeacherConflict.hasConflict ? (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                              ) : (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                              )}
                              <div>
                                <p className="font-semibold">
                                  {liveTeacherConflict.hasConflict
                                    ? `Konflik Data pada ${signupClass} — Menunggu Persetujuan`
                                    : `Slot ${signupRoleSlug === 'wali_kelas' ? 'Wali Kelas' : 'Guru Pendamping'} ${signupClass} Tersedia — Langsung Sinkron`}
                                </p>
                                <p className="mt-0.5 leading-relaxed opacity-90">
                                  {liveTeacherConflict.hasConflict
                                    ? `Saat ini sudah terdaftar "${liveTeacherConflict.existingValue}". Setelah dikirim, data pendaftaran disimpan berstatus Pending agar Super Admin / Admin / Kepala Perpustakaan dapat melihat konflik dan memilih mana yang diterapkan. Jika disetujui (Ya) akun berhasil dibuat; jika ditolak (Tidak) akun tidak disimpan.`
                                    : `Nama Anda akan langsung disinkronkan sebagai ${signupRoleSlug === 'wali_kelas' ? 'Wali Kelas' : 'Guru Pendamping'} di data rombel & jadwal baca ${signupClass}.`}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Gender selector for Students */}
                        {roleConfig.showGenderField && (
                          <SelectField
                            label="Jenis Kelamin *"
                            value={signupGender}
                            onChange={(e) => setSignupGender(e.target.value as 'L' | 'P')}
                          >
                            <option value="L">Laki-laki</option>
                            <option value="P">Perempuan</option>
                          </SelectField>
                        )}

                        {/* Identity Number Field (NIS / NIP / ID) */}
                        <TextField
                          label={`${roleConfig.identityFieldLabel}${roleConfig.identityRequired ? ' *' : ''}`}
                          value={signupIdentity}
                          onChange={(e) => setSignupIdentity(e.target.value)}
                          placeholder={roleConfig.identityFieldPlaceholder}
                          required={roleConfig.identityRequired}
                        />

                        {/* Phone Field */}
                        {roleConfig.showPhoneField && (
                          <TextField
                            label="Nomor HP / WhatsApp (Opsional)"
                            value={signupPhone}
                            onChange={(e) => setSignupPhone(e.target.value)}
                            placeholder="Contoh: 081234567890"
                          />
                        )}

                        {/* Role-Specific Extra Fields */}
                        {roleConfig.extraFields.map((field) =>
                          field.type === 'select' ? (
                            <SelectField
                              key={field.key}
                              label={`${field.label}${field.required ? ' *' : ''}`}
                              value={signupExtraMeta[field.key] || ''}
                              onChange={(e) =>
                                setSignupExtraMeta((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                            >
                              <option value="">-- Pilih {field.label} --</option>
                              {(field.options || []).map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </SelectField>
                          ) : (
                            <TextField
                              key={field.key}
                              label={`${field.label}${field.required ? ' *' : ''}`}
                              value={signupExtraMeta[field.key] || ''}
                              onChange={(e) =>
                                setSignupExtraMeta((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                              placeholder={field.placeholder}
                              required={field.required}
                            />
                          )
                        )}
                      </div>
                    </div>

                    {IS_FIRESTORE_ONLY_MODE ? (
                      <div className="space-y-3 pt-1">
                        <TextField
                          label="Nama Lengkap untuk Profil Sekolah (Opsional, default dari akun Google)"
                          value={signupFullName}
                          onChange={(e) => setSignupFullName(e.target.value)}
                          placeholder="Contoh: Ibu Rina Kusuma, S.Pd."
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          loading={googleLoading}
                          onClick={() => void handleGoogleLogin(true)}
                          className="w-full border-[#D5D0C5] bg-white hover:bg-[#EFECE3] text-[#1E2433] font-medium"
                        >
                          <Globe className="h-4 w-4 text-[#E56B63]" />
                          {willRequireApproval
                            ? 'Daftar dengan Google & Simpan Status Pending (Firestore)'
                            : 'Daftar & Masuk dengan Google (Firebase)'}
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
                        {/* 3. Account Credentials */}
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
                            className="sm:col-span-2"
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

                        <div className="space-y-2.5">
                          <Button
                            type="submit"
                            loading={loading}
                            className="w-full !h-auto min-h-[42px] py-2.5 whitespace-normal text-center leading-snug"
                          >
                            <UserPlus className="h-4 w-4 shrink-0" />
                            <span>
                              {liveTeacherConflict?.hasConflict
                                ? 'Ajukan Pendaftaran (Resolusi Konflik)'
                                : selectedSignupRole?.requiresApproval
                                  ? 'Daftar & Ajukan Persetujuan'
                                  : 'Daftar & Masuk Sekarang'}
                            </span>
                          </Button>

                          <Button
                            type="button"
                            variant="secondary"
                            loading={googleLoading}
                            onClick={() => void handleGoogleLogin(true)}
                            className="w-full !h-auto min-h-[42px] py-2.5 whitespace-normal text-center leading-snug border-[#D5D0C5] bg-white hover:bg-[#EFECE3] text-[#1E2433] font-medium"
                          >
                            <Globe className="h-4 w-4 shrink-0 text-[#E56B63]" />
                            <span>Daftar dengan Google (Cloud Firestore)</span>
                          </Button>
                        </div>
                      </>
                    )}
                  </form>
                </div>
              )
            )}
          </div>

          <p className="mt-6 border-t border-[#EAE7DF] pt-4 text-xs text-[#7B7D82]">
            {IS_FIRESTORE_ONLY_MODE
              ? 'Ditenagai oleh Firebase Auth & Cloud Firestore (status Pending tersimpan permanen di Firestore).'
              : 'Mendukung Firebase Auth + Cloud Firestore serta sesi lokal sekolah terenkripsi HMAC-SHA256.'}
          </p>
        </motion.div>

        {/* Role Quick-Fill Accounts (Hybrid / Local Dev Mode Only) */}
        {!IS_FIRESTORE_ONLY_MODE && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: MOTION_DURATION.normal, delay: 0.06, ease: EASE_EDITORIAL }}
            className="md:col-span-5 rounded-2xl border border-[#E7E4DC] bg-[#FAF9F5] p-6 sm:p-8 flex flex-col justify-between"
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

            <div className="mt-6 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE]/80 p-4 text-xs text-[#5C5E64] space-y-1.5">
              <p className="font-semibold text-[#1E2433]">Alur Sinkronisasi &amp; Persetujuan</p>
              <p>
                • <strong>Siswa &amp; Duta Literasi</strong> memilih kelas dari dropdown rombel aktif sekolah dan otomatis sinkron ke daftar siswa.
              </p>
              <p>
                • <strong>Wali Kelas &amp; Guru Pendamping</strong> memilih kelas binaan: jika slot kosong langsung sinkron ke rombel &amp; jadwal; jika sudah terisi masuk antrean <strong>Pending</strong> untuk ditinjau.
              </p>
              <p>
                • <strong>Super Admin, Admin Perpus &amp; Kepala Perpus</strong> dapat melihat konflik data, memilih bagian yang diterapkan, lalu memutuskan <strong>Ya</strong> (akun berhasil dibuat) atau <strong>Tidak</strong> (akun gagal &amp; tidak disimpan).
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
