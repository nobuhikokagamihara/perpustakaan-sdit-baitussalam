'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
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
import {
  buildRegistrationRequestCode,
  buildUnitOrClassLabel,
  detectClassTeacherConflict,
  detectLibraryLeadershipConflict,
  resolveMembershipTypeCodeForSignup,
} from '@/lib/domain/signup-rules';

const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = Object.fromEntries(
  SCHOOL_ROLE_CATALOG.map((r) => [r.slug, r.permissions])
);

function classNameToDocId(className: string): string {
  const short = className.replace(/^Kelas\s+/i, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `class_${short || '1a'}`;
}

export type { LibraryIdentity };

export interface SessionUser {
  id: number;
  uid?: string;
  username: string;
  email: string;
  fullName: string;
  roleSlug: string;
  roleName: string;
  assignedClass?: string;
  memberId: number | null;
  memberDocId?: string | null;
  permissions: string[];
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  requestedRoleSlug?: string | null;
}

export interface PendingRegistrationInfo {
  requestId?: string | number;
  requestCode: string;
  email: string;
  fullName: string;
  requestedRoleSlug: string;
  requestedRoleName: string;
  assignedClass: string;
  hasConflict: boolean;
  conflictType: string;
  conflictExistingValue: string;
  conflictSummary: string;
  status: 'pending' | 'rejected' | 'approved';
  decisionNote?: string;
  source: 'firestore' | 'local';
}

export interface GoogleSignupContext {
  roleSlug?: string;
  fullName?: string;
  assignedClass?: string;
  identityNumber?: string;
  gender?: string;
  phone?: string;
  extraMeta?: Record<string, string>;
}

export interface SignupPayload {
  fullName: string;
  email: string;
  username?: string;
  password: string;
  roleSlug: string;
  assignedClass?: string;
  unitOrClass?: string;
  identityNumber?: string;
  gender?: string;
  phone?: string;
  extraMeta?: Record<string, string>;
}

export interface SignupResult {
  pendingApproval: boolean;
  message: string;
  requestCode?: string;
  hasConflict?: boolean;
  syncSummary?: string;
  conflictInfo?: {
    conflictType: string | null;
    assignedClass: string;
    existingValue: string;
    summary: string;
  } | null;
  user?: SessionUser;
}

export interface GoogleLoginResult {
  pendingApproval: boolean;
  message?: string;
  syncSummary?: string;
  pendingRegistration?: PendingRegistrationInfo | null;
  user?: SessionUser | null;
}

interface AuthContextValue {
  user: SessionUser | null;
  pendingRegistration: PendingRegistrationInfo | null;
  library: LibraryIdentity;
  unreadNotifications: number;
  loading: boolean;
  authMode: 'firebase' | 'local';
  isFirebaseSession: boolean;
  refreshSession: () => Promise<void>;
  clearPendingRegistration: () => void;
  loginWithCredentials: (identifier: string, password: string) => Promise<SessionUser>;
  signupWithCredentials: (payload: SignupPayload) => Promise<SignupResult>;
  loginWithGoogle: (signupContext?: string | GoogleSignupContext) => Promise<GoogleLoginResult>;
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

const ALLOWED_SELF_SIGNUP_ROLES = new Set([
  'anggota',
  'siswa',
  'duta_literasi',
  'wali_kelas',
  'guru_pendamping',
  'guru_mapel',
  'guru_bk',
  'komite_sekolah',
  'petugas_kebersihan_keamanan',
  'pengunjung',
]);

async function resolveFirebaseSession(
  fbUser: FirebaseUser,
  signupContext?: GoogleSignupContext
): Promise<{
  sessionUser: SessionUser | null;
  pendingRegistration: PendingRegistrationInfo | null;
  libraryIdentity: LibraryIdentity | null;
  syncSummary?: string;
}> {
  const db = getFirestoreClient();
  const uid = sanitizeDocId(fbUser.uid);
  const email = clampString(fbUser.email, 160, `${uid}@google.local`);
  const displayName = clampString(
    signupContext?.fullName || fbUser.displayName,
    120,
    email.split('@')[0] || 'Pengguna Google'
  );

  // Load public library settings for identity & leadership conflict detection
  let libraryIdentity: LibraryIdentity | null = null;
  let globalSettingVals: Record<string, string> = {};
  try {
    const globalSnap = await getDoc(doc(db, 'library_settings', 'global'));
    if (globalSnap.exists()) {
      globalSettingVals = (globalSnap.data().values as Record<string, string>) || {};
      libraryIdentity = extractLibraryIdentity(globalSettingVals);
    }
  } catch {
    // Public fallback to defaultLibrary
  }

  // 1. Check Bootstrap admin or existing staff_roles/{uid}
  let roleSlug = '';
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
        const candidate = String(roleSnap.data().role || '');
        if (/^[a-z][a-z0-9_]*$/.test(candidate)) {
          roleSlug = candidate;
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `staff_roles/${uid}`);
    }
  }

  // 2. Check existing /users/{uid} and /registration_requests/{uid}
  let existingUserSnapData: Record<string, unknown> | null = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      existingUserSnapData = userSnap.data();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  let existingRegReq: Record<string, unknown> | null = null;
  if (!roleSlug && !existingUserSnapData) {
    try {
      const reqSnap = await getDoc(doc(db, 'registration_requests', uid));
      if (reqSnap.exists()) {
        existingRegReq = reqSnap.data();
      }
    } catch {
      // ignore if none
    }
  }

  // If user is NOT an active user yet and already has a pending registration_request in Firestore,
  // keep showing their persisted pending status even after closing & reopening the browser!
  if (!roleSlug && !existingUserSnapData && existingRegReq) {
    const reqStatus = String(existingRegReq.status || 'pending') as 'pending' | 'rejected' | 'approved';
    const reqRoleSlug = String(existingRegReq.requestedRole || 'anggota');
    if (reqStatus === 'pending' || (reqStatus === 'rejected' && !signupContext?.roleSlug)) {
      return {
        sessionUser: null,
        pendingRegistration: {
          requestId: uid,
          requestCode: String(existingRegReq.requestCode || ''),
          email: String(existingRegReq.email || email),
          fullName: String(existingRegReq.fullName || displayName),
          requestedRoleSlug: reqRoleSlug,
          requestedRoleName: ROLE_LABELS[reqRoleSlug] || reqRoleSlug,
          assignedClass: String(existingRegReq.assignedClass || ''),
          hasConflict: Boolean(existingRegReq.hasConflict),
          conflictType: String(existingRegReq.conflictType || ''),
          conflictExistingValue: String(existingRegReq.conflictExistingValue || ''),
          conflictSummary: String(existingRegReq.conflictSummary || ''),
          status: reqStatus,
          decisionNote: String(existingRegReq.decisionNote || ''),
          source: 'firestore',
        },
        libraryIdentity,
      };
    }
    // If previous request was rejected and user is submitting a new signup, remove the old rejected doc first
    if (reqStatus === 'rejected' && signupContext?.roleSlug) {
      try {
        await deleteDoc(doc(db, 'registration_requests', uid));
      } catch {
        // ignore
      }
    }
  }

  // 3. New signup evaluation (when no active users/{uid} exists yet and not bootstrap admin)
  const cleanRequestedRole =
    signupContext?.roleSlug &&
    signupContext.roleSlug !== 'super_admin' &&
    /^[a-z][a-z0-9_]*$/.test(signupContext.roleSlug)
      ? signupContext.roleSlug
      : 'anggota';

  const assignedClass = clampString(signupContext?.assignedClass, 60, '');
  const extraMeta = signupContext?.extraMeta || {};
  const unitOrClass = buildUnitOrClassLabel(cleanRequestedRole, assignedClass, extraMeta);
  const identityNumber = clampString(signupContext?.identityNumber, 64, '');
  const gender = clampString(signupContext?.gender, 24, '');
  const phone = clampString(signupContext?.phone, 32, '');

  let syncSummary = '';

  if (!roleSlug && !existingUserSnapData) {
    // Detect conflict for wali_kelas / guru_pendamping against public_classes / school_classes
    let classRecord: {
      docId: string;
      className: string;
      gradeLevel: number;
      homeroomTeacher: string;
      companionTeacher: string;
    } | null = null;

    if (assignedClass) {
      const classDocId = sanitizeDocId(classNameToDocId(assignedClass));
      try {
        const scSnap = await getDoc(doc(db, 'school_classes', classDocId));
        if (scSnap.exists()) {
          const d = scSnap.data();
          classRecord = {
            docId: classDocId,
            className: String(d.className || assignedClass),
            gradeLevel: Number(d.gradeLevel || 1),
            homeroomTeacher: String(d.homeroomTeacher || ''),
            companionTeacher: String(d.companionTeacher || ''),
          };
        } else {
          const pcSnap = await getDoc(doc(db, 'public_classes', classDocId));
          if (pcSnap.exists()) {
            const d = pcSnap.data();
            classRecord = {
              docId: classDocId,
              className: String(d.className || assignedClass),
              gradeLevel: Number(d.gradeLevel || 1),
              homeroomTeacher: String(d.homeroomTeacher || ''),
              companionTeacher: String(d.companionTeacher || ''),
            };
          }
        }
      } catch {
        // ignore lookup failure
      }
    }

    const classConflict = detectClassTeacherConflict({
      roleSlug: cleanRequestedRole,
      selectedClass: assignedClass,
      applicantFullName: displayName,
      classRecord,
    });

    const leadershipConflict = detectLibraryLeadershipConflict({
      roleSlug: cleanRequestedRole,
      applicantFullName: displayName,
      principalName: globalSettingVals.principal_name,
      librarianHeadName: globalSettingVals.librarian_head_name,
    });

    const effectiveConflict = classConflict.hasConflict
      ? classConflict
      : leadershipConflict.hasConflict
        ? leadershipConflict
        : classConflict;

    const needsApproval = doesRoleRequireApproval(cleanRequestedRole);
    const mustQueuePending = needsApproval || classConflict.hasConflict;

    if (mustQueuePending) {
      // Persist ONLY to Firestore registration_requests/{uid} with status: 'pending'.
      // Do NOT create users/{uid}, members, or staff_roles until approved!
      const requestCode = buildRegistrationRequestCode();
      try {
        await setDoc(doc(db, 'registration_requests', uid), {
          requestCode,
          requesterUid: uid,
          email,
          fullName: displayName,
          requestedRole: cleanRequestedRole,
          assignedClass,
          teacherSlot: classConflict.slot || '',
          unitOrClass,
          identityNumber,
          gender,
          phone,
          extraMeta,
          hasConflict: effectiveConflict.hasConflict,
          conflictType: effectiveConflict.conflictType || '',
          conflictExistingValue: effectiveConflict.existingValue || '',
          conflictSummary: effectiveConflict.summary || '',
          status: 'pending',
          decisionNote: '',
          resolution: {},
          reviewedByUid: '',
          reviewedByName: '',
          reviewedAt: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `registration_requests/${uid}`);
      }

      setGatewayFirebaseActor(null);
      return {
        sessionUser: null,
        pendingRegistration: {
          requestId: uid,
          requestCode,
          email,
          fullName: displayName,
          requestedRoleSlug: cleanRequestedRole,
          requestedRoleName: ROLE_LABELS[cleanRequestedRole] || cleanRequestedRole,
          assignedClass,
          hasConflict: effectiveConflict.hasConflict,
          conflictType: effectiveConflict.conflictType || '',
          conflictExistingValue: effectiveConflict.existingValue || '',
          conflictSummary: effectiveConflict.summary || '',
          status: 'pending',
          source: 'firestore',
        },
        libraryIdentity,
      };
    }

    // Conflict-free immediate self-signup in Firestore
    const safeRole = ALLOWED_SELF_SIGNUP_ROLES.has(cleanRequestedRole) ? cleanRequestedRole : 'anggota';
    roleSlug = safeRole;

    try {
      await setDoc(doc(db, 'users', uid), {
        uid,
        email,
        fullName: displayName,
        role: safeRole,
        requestedRole: safeRole,
        approvalStatus: 'approved',
        assignedClass,
        memberId: '',
        memberCode: '',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      existingUserSnapData = {
        uid,
        email,
        fullName: displayName,
        role: safeRole,
        requestedRole: safeRole,
        approvalStatus: 'approved',
        assignedClass,
        memberId: '',
        memberCode: '',
        isActive: true,
      };

      // Directly sync empty wali_kelas / guru_pendamping slot to school_classes & public_classes
      if (
        (safeRole === 'wali_kelas' || safeRole === 'guru_pendamping') &&
        assignedClass &&
        classRecord &&
        !classConflict.hasConflict
      ) {
        const teacherField = safeRole === 'wali_kelas' ? 'homeroomTeacher' : 'companionTeacher';
        try {
          await updateDoc(doc(db, 'school_classes', classRecord.docId), {
            [teacherField]: displayName,
            updatedByUid: uid,
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'public_classes', classRecord.docId), {
            [teacherField]: displayName,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          syncSummary = `${ROLE_LABELS[safeRole] || safeRole} untuk ${assignedClass} langsung tersinkron ke data kelas.`;
        } catch {
          // ignore if class doc not yet seeded
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
    }
  } else if (!existingUserSnapData && roleSlug === 'super_admin') {
    // Bootstrap admin first login
    try {
      await setDoc(doc(db, 'users', uid), {
        uid,
        email,
        fullName: displayName,
        role: 'super_admin',
        approvalStatus: 'approved',
        assignedClass: '',
        memberId: '',
        memberCode: '',
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      existingUserSnapData = {
        uid,
        email,
        fullName: displayName,
        role: 'super_admin',
        approvalStatus: 'approved',
        assignedClass: '',
        memberId: '',
        memberCode: '',
        isActive: true,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
    }
  } else if (existingUserSnapData) {
    if (roleSlug === 'super_admin' && existingUserSnapData.role !== 'super_admin') {
      try {
        await updateDoc(doc(db, 'users', uid), {
          role: 'super_admin',
          approvalStatus: 'approved',
          updatedAt: serverTimestamp(),
        });
      } catch {
        // ignore
      }
    }
    if (!roleSlug) {
      const storedRole = String(existingUserSnapData.role || 'anggota');
      roleSlug = /^[a-z][a-z0-9_]*$/.test(storedRole) ? storedRole : 'anggota';
    }
  }

  if (!roleSlug) roleSlug = 'anggota';

  // 4. Seed database idempotently when a staff member signs in
  if (isStaffRoleSlug(roleSlug)) {
    const { ensureFirestoreSeeded } = await import('@/lib/firebase/firestore-seed');
    await ensureFirestoreSeeded(uid, displayName);
  }

  // 5. Ensure linked member record for non-staff / non-visitor users
  let memberDocId: string | null = existingUserSnapData?.memberId
    ? String(existingUserSnapData.memberId)
    : null;
  let memberNumericId: number | null = null;
  const userAssignedClass = existingUserSnapData?.assignedClass
    ? String(existingUserSnapData.assignedClass)
    : assignedClass;

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
        const targetTypeCode =
          resolveMembershipTypeCodeForSignup({
            roleSlug,
            assignedClass: userAssignedClass,
            memberSubStatus: extraMeta.memberSubStatus,
          }) || 'SISWA_TINGGI';
        const mTypeMap: Record<string, { id: string; name: string }> = {
          SISWA_RENDAH: { id: 'mtype_1', name: 'Siswa Kelas 1–3' },
          SISWA_TINGGI: { id: 'mtype_2', name: 'Siswa Kelas 4–6' },
          GURU: { id: 'mtype_3', name: 'Guru & Wali Kelas' },
          STAF: { id: 'mtype_4', name: 'Staf & Tata Usaha' },
          KOMITE: { id: 'mtype_5', name: 'Orang Tua / Komite Sekolah' },
        };
        const mTypeChoice = mTypeMap[targetTypeCode] || mTypeMap.SISWA_TINGGI;

        await setDoc(doc(db, 'members', candidateDocId), {
          numericId,
          memberCode,
          fullName: displayName,
          membershipTypeId: mTypeChoice.id,
          membershipTypeName: mTypeChoice.name,
          identityNumber,
          gender: gender === 'L' ? 'Laki-laki' : gender === 'P' ? 'Perempuan' : 'Tidak Disebutkan',
          unitOrClass: unitOrClass || userAssignedClass || ROLE_LABELS[roleSlug] || 'Siswa SD',
          address: '',
          phone,
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

  // 6. Load role permissions
  let permissions =
    ROLE_PERMISSION_DEFAULTS[roleSlug] ||
    SCHOOL_ROLE_MAP.get(roleSlug)?.permissions ||
    ROLE_PERMISSION_DEFAULTS.anggota;
  let customRoleName = '';

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

  const roleName = customRoleName || ROLE_LABELS[roleSlug] || 'Warga Sekolah';
  const approvalStatus =
    (existingUserSnapData?.approvalStatus as 'approved' | 'pending' | 'rejected') || 'approved';
  const requestedRoleSlug = existingUserSnapData?.requestedRole
    ? String(existingUserSnapData.requestedRole)
    : null;

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
    assignedClass: userAssignedClass,
    memberId: memberNumericId,
    memberDocId,
    permissions,
    approvalStatus,
    requestedRoleSlug,
  };

  return { sessionUser, pendingRegistration: null, libraryIdentity, syncSummary };
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
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistrationInfo | null>(
    null
  );
  const [library, setLibrary] = useState<LibraryIdentity>(initialLibrary ?? defaultLibrary);
  const [unreadNotifications, setUnreadNotifications] = useState(initialUnreadNotifications ?? 0);
  const [loading, setLoading] = useState(initialUser === undefined);
  const [authMode, setAuthMode] = useState<'firebase' | 'local'>('local');
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const loginInProgressRef = useRef(false);

  const clearPendingRegistration = useCallback(() => {
    setPendingRegistration(null);
  }, []);

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
        // Public fallback
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
      const resolved = await resolveFirebaseSession(auth.currentUser);
      setUser(resolved.sessionUser);
      setPendingRegistration(resolved.pendingRegistration);
      if (resolved.libraryIdentity) setLibrary(resolved.libraryIdentity);
      setAuthMode('firebase');
      setFirebaseUid(resolved.sessionUser ? auth.currentUser.uid : null);
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
          const resolved = await resolveFirebaseSession(fbUser);
          if (!active) return;
          setUser(resolved.sessionUser);
          setPendingRegistration(resolved.pendingRegistration);
          if (resolved.libraryIdentity) setLibrary(resolved.libraryIdentity);
          setAuthMode('firebase');
          setFirebaseUid(resolved.sessionUser ? fbUser.uid : null);
          setLoading(false);
        } else {
          setGatewayFirebaseActor(null);
          if (!active) return;
          setPendingRegistration(null);
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

  useEffect(() => {
    if (typeof document !== 'undefined' && library.name) {
      document.title = `${library.name} — Sistem Perpustakaan Sekolah Dasar`;
    }
  }, [library.name]);

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
            // ignore
          }
        }
        setGatewayFirebaseActor(null);
        setFirebaseUid(null);
        setPendingRegistration(null);
        setAuthMode('local');

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier.trim(), password }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.pendingApproval && data.requestCode) {
            setPendingRegistration({
              requestCode: String(data.requestCode),
              email: identifier.trim(),
              fullName: identifier.trim(),
              requestedRoleSlug: '',
              requestedRoleName: String(data.roleName || 'Warga Sekolah'),
              assignedClass: String(data.assignedClass || ''),
              hasConflict: Boolean(data.hasConflict),
              conflictType: '',
              conflictExistingValue: '',
              conflictSummary: String(data.conflictSummary || ''),
              status: 'pending',
              source: 'local',
            });
          }
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

        if (data.pendingApproval) {
          setPendingRegistration({
            requestId: data.requestId,
            requestCode: String(data.requestCode || ''),
            email: payload.email,
            fullName: payload.fullName,
            requestedRoleSlug: payload.roleSlug,
            requestedRoleName: ROLE_LABELS[payload.roleSlug] || payload.roleSlug,
            assignedClass: payload.assignedClass || '',
            hasConflict: Boolean(data.hasConflict),
            conflictType: data.conflictInfo?.conflictType || '',
            conflictExistingValue: data.conflictInfo?.existingValue || '',
            conflictSummary: data.conflictInfo?.summary || '',
            status: 'pending',
            source: 'local',
          });
          return {
            pendingApproval: true,
            requestCode: String(data.requestCode || ''),
            hasConflict: Boolean(data.hasConflict),
            conflictInfo: data.conflictInfo || null,
            message: String(
              data.message ||
                'Pendaftaran berstatus Pending menunggu persetujuan Super Admin / Admin / Kepala Perpustakaan.'
            ),
          };
        }

        const signedUser = data.user as SessionUser;
        if (data.token) {
          setLocalSessionToken(String(data.token));
        }
        setPendingRegistration(null);
        setUser(signedUser);
        setAuthMode('local');
        setFirebaseUid(null);
        setAuthReady(true);
        markGatewayAuthReady();
        setLoading(false);
        void loadLocalSession();

        return {
          pendingApproval: false,
          syncSummary: data.syncSummary ? String(data.syncSummary) : '',
          message: data.syncSummary ? String(data.syncSummary) : 'Akun berhasil dibuat.',
          user: signedUser,
        };
      } finally {
        loginInProgressRef.current = false;
      }
    },
    [loadLocalSession]
  );

  const loginWithGoogle = useCallback(
    async (signupContextArg?: string | GoogleSignupContext): Promise<GoogleLoginResult> => {
      loginInProgressRef.current = true;
      try {
        const ctx: GoogleSignupContext | undefined =
          typeof signupContextArg === 'string'
            ? { roleSlug: signupContextArg }
            : signupContextArg;

        const auth = getAuthClient();
        const cred = await signInWithPopup(auth, googleProvider);
        if (!cred.user.emailVerified) {
          await signOut(auth);
          throw new Error('auth/email-not-verified');
        }
        setLocalSessionToken(null);
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch {
          // ignore
        }

        const resolved = await resolveFirebaseSession(cred.user, ctx);
        if (resolved.libraryIdentity) setLibrary(resolved.libraryIdentity);

        if (!resolved.sessionUser && resolved.pendingRegistration) {
          setUser(null);
          setPendingRegistration(resolved.pendingRegistration);
          setAuthMode('firebase');
          setFirebaseUid(null);
          setAuthReady(true);
          markGatewayAuthReady();
          setLoading(false);
          return {
            pendingApproval: true,
            pendingRegistration: resolved.pendingRegistration,
            message:
              resolved.pendingRegistration.status === 'rejected'
                ? resolved.pendingRegistration.decisionNote ||
                  'Pendaftaran akun Anda ditolak sehingga akun tidak disimpan.'
                : resolved.pendingRegistration.hasConflict
                  ? `Terdeteksi konflik data (${resolved.pendingRegistration.conflictExistingValue}). Pendaftaran Anda (${resolved.pendingRegistration.requestCode}) tersimpan di Firestore dengan status Pending. Anda dapat menutup browser dengan aman.`
                  : `Pendaftaran Anda (${resolved.pendingRegistration.requestCode}) tersimpan di Firestore dengan status Pending menunggu persetujuan Super Admin / Admin / Kepala Perpustakaan.`,
            user: null,
          };
        }

        setPendingRegistration(null);
        setUser(resolved.sessionUser);
        setAuthMode('firebase');
        setFirebaseUid(cred.user.uid);
        setAuthReady(true);
        markGatewayAuthReady();
        setLoading(false);
        return {
          pendingApproval: false,
          syncSummary: resolved.syncSummary,
          user: resolved.sessionUser,
        };
      } finally {
        loginInProgressRef.current = false;
      }
    },
    []
  );

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
    setPendingRegistration(null);
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
        pendingRegistration,
        library,
        unreadNotifications,
        loading,
        authMode,
        isFirebaseSession: authMode === 'firebase',
        refreshSession,
        clearPendingRegistration,
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
