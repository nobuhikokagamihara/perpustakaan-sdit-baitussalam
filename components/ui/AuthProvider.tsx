'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  clampString,
  getAuthClient,
  getFirestoreClient,
  googleProvider,
  handleFirestoreError,
  IS_FIRESTORE_ONLY_MODE,
  OperationType,
  sanitizeDocId,
  testConnection,
} from '@/lib/firebase/client';
import { ensureFirestoreSeeded, ROLE_PERMISSION_DEFAULTS } from '@/lib/firebase/firestore-seed';
import {
  getLocalAuthHeaders,
  markGatewayAuthReady,
  setGatewayFirebaseActor,
  setLocalSessionToken,
} from '@/lib/client/data-gateway';
import { addDaysIso, formatIsoDate } from '@/lib/domain/library-rules';
import {
  SCHOOL_ROLE_CATALOG,
  SCHOOL_ROLE_MAP,
  doesRoleRequireApproval,
  extractLibraryIdentity,
  type LibraryIdentity,
} from '@/lib/domain/settings-backup-rules';

export type { LibraryIdentity };

export interface SessionUser {
  id: number;
  uid?: string;
  username: string;
  email: string;
  fullName: string;
  roleSlug: string;
  roleName: string;
  memberId: number | null;
  memberDocId?: string | null;
  permissions: string[];
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  requestedRoleSlug?: string | null;
}

export interface SignupPayload {
  fullName: string;
  email: string;
  username?: string;
  password: string;
  roleSlug: string;
  unitOrClass?: string;
  identityNumber?: string;
}

export interface SignupResult {
  pendingApproval: boolean;
  message: string;
  user: SessionUser;
}

interface AuthContextValue {
  user: SessionUser | null;
  library: LibraryIdentity;
  unreadNotifications: number;
  loading: boolean;
  authMode: 'firebase' | 'local';
  isFirebaseSession: boolean;
  refreshSession: () => Promise<void>;
  loginWithCredentials: (identifier: string, password: string) => Promise<SessionUser>;
  signupWithCredentials: (payload: SignupPayload) => Promise<SignupResult>;
  loginWithGoogle: (requestedRoleSlug?: string) => Promise<SessionUser>;
  logout: (redirectTo?: string) => Promise<void>;
  can: (permission: string) => boolean;
}

const defaultLibrary: LibraryIdentity = extractLibraryIdentity();

const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  SCHOOL_ROLE_CATALOG.map((r) => [r.slug, r.name])
);

const AuthContext = createContext<AuthContextValue | null>(null);

function isStaffRoleSlug(slug: string): boolean {
  return [
    'super_admin',
    'kepala_sekolah',
    'wakil_kepala_sekolah',
    'kepala_perpustakaan',
    'admin_perpus',
    'pustakawan',
    'staff_tu',
    'bendahara_sekolah',
    'operator_it',
  ].includes(slug);
}

async function resolveFirebaseSession(
  fbUser: FirebaseUser,
  signupRequestedRoleSlug?: string
): Promise<{
  sessionUser: SessionUser;
  libraryIdentity: LibraryIdentity | null;
}> {
  const db = getFirestoreClient();
  const uid = sanitizeDocId(fbUser.uid);
  const email = clampString(fbUser.email, 160, `${uid}@google.local`);
  const displayName = clampString(fbUser.displayName, 120, email.split('@')[0] || 'Pengguna Google');

  // 1. Determine role (Bootstrap admin -> staff_roles/{uid} -> default anggota)
  let roleSlug = 'anggota';
  const bootstrapAdmins = [
    BOOTSTRAP_ADMIN_EMAIL.toLowerCase().trim(),
    'nobuhikokagamihara@gmail.com',
    'arsip.raporbts@gmail.com',
  ];
  if (bootstrapAdmins.includes(email.toLowerCase().trim())) {
    roleSlug = 'super_admin';
  } else {
    try {
      const roleSnap = await getDoc(doc(db, 'staff_roles', uid));
      if (roleSnap.exists() && roleSnap.data().isActive === true) {
        const candidate = String(roleSnap.data().role || 'anggota');
        if (/^[a-z][a-z0-9_]*$/.test(candidate)) {
          roleSlug = candidate;
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `staff_roles/${uid}`);
    }
  }

  // 2. Ensure /users/{uid} exists (always create with role: 'anggota' per security rules)
  const cleanRequestedRole =
    signupRequestedRoleSlug && signupRequestedRoleSlug !== 'super_admin' && /^[a-z][a-z0-9_]*$/.test(signupRequestedRoleSlug)
      ? signupRequestedRoleSlug
      : '';
  const needsApproval = cleanRequestedRole ? doesRoleRequireApproval(cleanRequestedRole) : false;

  let userDocData: Record<string, unknown> | null = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        email,
        fullName: displayName,
        role: 'anggota',
        ...(cleanRequestedRole ? { requestedRole: cleanRequestedRole } : {}),
        approvalStatus: needsApproval ? 'pending' : 'approved',
        memberId: '',
        memberCode: '',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (roleSlug === 'super_admin') {
        await updateDoc(doc(db, 'users', uid), {
          role: 'super_admin',
          approvalStatus: 'approved',
          updatedAt: serverTimestamp(),
        });
      }
      userDocData = {
        uid,
        email,
        fullName: displayName,
        role: roleSlug,
        requestedRole: cleanRequestedRole,
        approvalStatus: roleSlug === 'super_admin' ? 'approved' : needsApproval ? 'pending' : 'approved',
        memberId: '',
        memberCode: '',
      };
    } else {
      userDocData = userSnap.data();
      if (roleSlug === 'super_admin' && userDocData?.role !== 'super_admin') {
        await updateDoc(doc(db, 'users', uid), {
          role: 'super_admin',
          approvalStatus: 'approved',
          updatedAt: serverTimestamp(),
        });
      }
      if (
        roleSlug === 'anggota' &&
        userDocData?.role &&
        typeof userDocData.role === 'string' &&
        !isStaffRoleSlug(userDocData.role)
      ) {
        roleSlug = userDocData.role;
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }

  // 3. Seed database idempotently when a staff member signs in
  if (isStaffRoleSlug(roleSlug)) {
    await ensureFirestoreSeeded(uid, displayName);
  }

  // 4. Ensure linked member record for non-staff / non-visitor users
  let memberDocId: string | null = userDocData?.memberId ? String(userDocData.memberId) : null;
  let memberNumericId: number | null = null;
  if (!isStaffRoleSlug(roleSlug) && roleSlug !== 'pengunjung') {
    try {
      const mQuery = query(collection(db, 'members'), where('ownerUid', '==', uid));
      const mSnap = await getDocs(mQuery);
      if (!mSnap.empty) {
        const firstMember = mSnap.docs[0];
        memberDocId = firstMember.id;
        memberNumericId = Number(firstMember.data().numericId || 1);
      } else {
        const candidateDocId = sanitizeDocId(`member_uid_${uid.slice(0, 20)}`);
        const numericId = Math.max(100, (Date.now() % 900000) + 100);
        const memberCode = `AGT-2026-${uid.slice(0, 6).toUpperCase()}`;
        const todayStr = formatIsoDate(new Date());
        const expiresAt = addDaysIso(todayStr, 365);

        await setDoc(doc(db, 'members', candidateDocId), {
          numericId,
          memberCode,
          fullName: displayName,
          membershipTypeId: 'mtype_2',
          membershipTypeName: 'Siswa Kelas 4–6',
          identityNumber: '',
          gender: 'Tidak Disebutkan',
          unitOrClass: ROLE_LABELS[roleSlug] || 'Siswa SD',
          address: '',
          phone: '',
          email,
          registeredAt: todayStr,
          expiresAt,
          status: 'Aktif',
          blockReason: '',
          ownerUid: uid,
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await updateDoc(doc(db, 'users', uid), {
          memberId: candidateDocId,
          memberCode,
          updatedAt: serverTimestamp(),
        });
        memberDocId = candidateDocId;
        memberNumericId = numericId;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `members/${uid}`);
    }
  }

  // 5. Load library identity and role permissions
  let libraryIdentity: LibraryIdentity | null = null;
  let permissions =
    ROLE_PERMISSION_DEFAULTS[roleSlug] ||
    SCHOOL_ROLE_MAP.get(roleSlug)?.permissions ||
    ROLE_PERMISSION_DEFAULTS.anggota;
  let customRoleName = '';

  try {
    const globalSnap = await getDoc(doc(db, 'library_settings', 'global'));
    if (globalSnap.exists()) {
      const vals = (globalSnap.data().values as Record<string, string>) || {};
      libraryIdentity = extractLibraryIdentity(vals);
    }
  } catch {
    // Public fallback to defaultLibrary if unseeded yet
  }

  if (isStaffRoleSlug(roleSlug) || !SCHOOL_ROLE_MAP.has(roleSlug)) {
    try {
      const rbacSnap = await getDoc(doc(db, 'library_settings', 'rbac'));
      if (rbacSnap.exists()) {
        const rp = (rbacSnap.data().rolePermissions as Record<string, string[]>) || {};
        const customRoles =
          (rbacSnap.data().customRoles as Record<string, { name?: string }>) || {};
        if (customRoles[roleSlug]?.name) {
          customRoleName = String(customRoles[roleSlug].name);
        }
        if (Array.isArray(rp[roleSlug])) {
          permissions = [...rp[roleSlug]];
        }
      }
    } catch {
      // fallback to ROLE_PERMISSION_DEFAULTS
    }
  }

  const roleName = customRoleName || ROLE_LABELS[roleSlug] || 'Siswa / Guru';
  const approvalStatus = (userDocData?.approvalStatus as 'approved' | 'pending' | 'rejected') || 'approved';
  const requestedRoleSlug = userDocData?.requestedRole ? String(userDocData.requestedRole) : null;

  setGatewayFirebaseActor({
    uid,
    email,
    fullName: displayName,
    roleSlug,
    roleName,
    memberDocId,
    memberNumericId,
    permissions,
  });

  const sessionUser: SessionUser = {
    id: memberNumericId || 1,
    uid,
    username: email.split('@')[0],
    email,
    fullName: displayName,
    roleSlug,
    roleName,
    memberId: memberNumericId,
    memberDocId,
    permissions,
    approvalStatus,
    requestedRoleSlug,
  };

  return { sessionUser, libraryIdentity };
}

export function AuthProvider({
  children,
  initialUser,
  initialLibrary,
  initialUnreadNotifications,
}: {
  children: React.ReactNode;
  initialUser?: SessionUser | null;
  initialLibrary?: LibraryIdentity;
  initialUnreadNotifications?: number;
}) {
  const [user, setUser] = useState<SessionUser | null>(initialUser ?? null);
  const [library, setLibrary] = useState<LibraryIdentity>(initialLibrary ?? defaultLibrary);
  const [unreadNotifications, setUnreadNotifications] = useState(initialUnreadNotifications ?? 0);
  const [loading, setLoading] = useState(initialUser === undefined);
  const [authMode, setAuthMode] = useState<'firebase' | 'local'>('local');
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const loginInProgressRef = useRef(false);

  const loadLocalSession = useCallback(async () => {
    if (IS_FIRESTORE_ONLY_MODE) {
      setUser(null);
      setUnreadNotifications(0);
      try {
        const db = getFirestoreClient();
        const globalSnap = await getDoc(doc(db, 'library_settings', 'global'));
        if (globalSnap.exists()) {
          const vals = (globalSnap.data().values as Record<string, string>) || {};
          setLibrary(extractLibraryIdentity(vals));
        }
      } catch {
        // Public fallback to defaultLibrary if unseeded or offline
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const res = await fetch('/api/auth/me', {
        cache: 'no-store',
        headers: getLocalAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.user) {
          setLocalSessionToken(null);
        }
        setUser(data.user || null);
        if (data.library) setLibrary(data.library);
        setUnreadNotifications(Number(data.unreadNotifications || 0));
      }
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const auth = getAuthClient();
    if (auth.currentUser && auth.currentUser.emailVerified) {
      const { sessionUser, libraryIdentity } = await resolveFirebaseSession(auth.currentUser);
      setUser(sessionUser);
      if (libraryIdentity) setLibrary(libraryIdentity);
      setAuthMode('firebase');
      setFirebaseUid(auth.currentUser.uid);
      setLoading(false);
      return;
    }
    setGatewayFirebaseActor(null);
    setAuthMode('local');
    setFirebaseUid(null);
    await loadLocalSession();
  }, [loadLocalSession]);

  useEffect(() => {
    void testConnection();
    const auth = getAuthClient();
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (loginInProgressRef.current) return;
      try {
        if (fbUser && fbUser.emailVerified) {
          const { sessionUser, libraryIdentity } = await resolveFirebaseSession(fbUser);
          if (!active) return;
          setUser(sessionUser);
          if (libraryIdentity) setLibrary(libraryIdentity);
          setAuthMode('firebase');
          setFirebaseUid(fbUser.uid);
          setLoading(false);
        } else {
          setGatewayFirebaseActor(null);
          if (!active) return;
          setAuthMode('local');
          setFirebaseUid(null);
          await loadLocalSession();
        }
      } catch {
        if (active) {
          setGatewayFirebaseActor(null);
          setAuthMode('local');
          setFirebaseUid(null);
          setLoading(false);
        }
      } finally {
        if (active) {
          setAuthReady(true);
          markGatewayAuthReady();
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadLocalSession]);

  // Keep browser document title synchronized whenever library name is updated in /settings
  useEffect(() => {
    if (typeof document !== 'undefined' && library.name) {
      document.title = `${library.name} — Sistem Perpustakaan Sekolah Dasar`;
    }
  }, [library.name]);

  // Real-time Firestore notification badge listener (bounded for Spark Free Tier read quota)
  const userRoleSlug = user?.roleSlug || '';
  useEffect(() => {
    if (!authReady || !firebaseUid || !userRoleSlug) return;
    const db = getFirestoreClient();
    const isStaff = isStaffRoleSlug(userRoleSlug);
    const qRef = isStaff
      ? query(collection(db, 'notifications'), where('isRead', '==', false), limit(50))
      : query(collection(db, 'notifications'), where('targetUid', '==', firebaseUid), limit(50));

    const unsubscribe = onSnapshot(
      qRef,
      (snap) => {
        const unread = snap.docs.filter((d) => d.data().isRead === false).length;
        setUnreadNotifications(unread);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'notifications');
      }
    );

    return () => {
      unsubscribe();
    };
  }, [authReady, firebaseUid, userRoleSlug]);

  const loginWithCredentials = useCallback(
    async (identifier: string, password: string): Promise<SessionUser> => {
      loginInProgressRef.current = true;
      try {
        const auth = getAuthClient();
        if (auth.currentUser) {
          try {
            await signOut(auth);
          } catch {
            // ignore Firebase signOut errors when switching to local login
          }
        }
        setGatewayFirebaseActor(null);
        setFirebaseUid(null);
        setAuthMode('local');

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier.trim(), password }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Email/username atau kata sandi tidak valid.');
        }

        if (data.token) {
          setLocalSessionToken(String(data.token));
        }
        const loggedUser = data.user as SessionUser;
        setUser(loggedUser);
        setAuthMode('local');
        setFirebaseUid(null);
        setAuthReady(true);
        markGatewayAuthReady();
        setLoading(false);

        // Sync unread notifications & library metadata in background
        void loadLocalSession();
        return loggedUser;
      } finally {
        loginInProgressRef.current = false;
      }
    },
    [loadLocalSession]
  );

  const signupWithCredentials = useCallback(
    async (payload: SignupPayload): Promise<SignupResult> => {
      loginInProgressRef.current = true;
      try {
        const auth = getAuthClient();
        if (auth.currentUser) {
          try {
            await signOut(auth);
          } catch {
            // ignore
          }
        }
        setGatewayFirebaseActor(null);
        setFirebaseUid(null);
        setAuthMode('local');

        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Pendaftaran akun gagal.');
        }

        const signedUser = data.user as SessionUser;
        if (data.pendingApproval) {
          return {
            pendingApproval: true,
            message: String(data.message || 'Menunggu persetujuan Super Admin.'),
            user: signedUser,
          };
        }

        if (data.token) {
          setLocalSessionToken(String(data.token));
        }
        setUser(signedUser);
        setAuthMode('local');
        setFirebaseUid(null);
        setAuthReady(true);
        markGatewayAuthReady();
        setLoading(false);
        void loadLocalSession();

        return {
          pendingApproval: false,
          message: 'Akun berhasil dibuat.',
          user: signedUser,
        };
      } finally {
        loginInProgressRef.current = false;
      }
    },
    [loadLocalSession]
  );

  const loginWithGoogle = useCallback(async (requestedRoleSlug?: string) => {
    loginInProgressRef.current = true;
    try {
      const auth = getAuthClient();
      const cred = await signInWithPopup(auth, googleProvider);
      if (!cred.user.emailVerified) {
        await signOut(auth);
        throw new Error('auth/email-not-verified');
      }
      // Clear any local session so local cookie never conflicts with Firebase mode
      setLocalSessionToken(null);
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }

      const { sessionUser, libraryIdentity } = await resolveFirebaseSession(
        cred.user,
        requestedRoleSlug
      );
      setUser(sessionUser);
      if (libraryIdentity) setLibrary(libraryIdentity);
      setAuthMode('firebase');
      setFirebaseUid(cred.user.uid);
      setAuthReady(true);
      markGatewayAuthReady();
      setLoading(false);
      return sessionUser;
    } finally {
      loginInProgressRef.current = false;
    }
  }, []);

  const logout = useCallback(async (redirectTo = '/catalog') => {
    const auth = getAuthClient();
    if (auth.currentUser) {
      try {
        await signOut(auth);
      } catch {
        // ignore
      }
    }
    setLocalSessionToken(null);
    setGatewayFirebaseActor(null);
    setFirebaseUid(null);
    setAuthMode('local');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
    setUnreadNotifications(0);
    window.location.href = redirectTo;
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!user) return false;
      if (user.permissions.includes('*')) return true;
      return user.permissions.includes(permission);
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        library,
        unreadNotifications,
        loading,
        authMode,
        isFirebaseSession: authMode === 'firebase',
        refreshSession,
        loginWithCredentials,
        signupWithCredentials,
        loginWithGoogle,
        logout,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
