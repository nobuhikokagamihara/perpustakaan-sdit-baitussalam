'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfigJson from '@/firebase-applet-config.json';
import {
  formatFirestoreQuotaMessage,
  isFirestoreQuotaError,
  resolveDataBackendMode,
  type DataBackendMode,
} from '@/lib/firebase/read-cache';

const resolvedFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseConfigJson.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || firebaseConfigJson.appId,
  firestoreDatabaseId:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || firebaseConfigJson.firestoreDatabaseId || '(default)',
};

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let connectionTested = false;

export const DATA_BACKEND_MODE: DataBackendMode = resolveDataBackendMode(
  process.env.NEXT_PUBLIC_DATA_BACKEND
);
export const IS_FIRESTORE_ONLY_MODE = DATA_BACKEND_MODE === 'firestore';
export const FIREBASE_PROJECT_ID = resolvedFirebaseConfig.projectId;
export const FIREBASE_DATABASE_ID = resolvedFirebaseConfig.firestoreDatabaseId;
export const BOOTSTRAP_ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_BOOTSTRAP_ADMIN_EMAIL || 'nobuhikokagamihara@gmail.com';

export function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp(resolvedFirebaseConfig);
  }
  return appInstance;
}

export function getFirestoreClient(): Firestore {
  if (!dbInstance) {
    const app = getFirebaseApp();
    const databaseId = resolvedFirebaseConfig.firestoreDatabaseId;
    // Enable persistent IndexedDB cache in browsers to minimize Firestore Free Tier daily reads.
    if (typeof window !== 'undefined') {
      try {
        dbInstance = initializeFirestore(
          app,
          {
            localCache: persistentLocalCache({
              tabManager: persistentMultipleTabManager(),
            }),
          },
          databaseId
        );
        return dbInstance;
      } catch {
        // Fallback when Firestore was already initialized or IndexedDB is unavailable
      }
    }
    // CRITICAL: Must pass firestoreDatabaseId
    dbInstance = getFirestore(app, databaseId);
  }
  return dbInstance;
}

export function getAuthClient(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  quotaExceeded?: boolean;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const auth = typeof window !== 'undefined' ? getAuthClient() : null;
  const currentUser = auth?.currentUser;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const quotaExceeded = isFirestoreQuotaError(error);

  const errInfo: FirestoreErrorInfo = {
    error: quotaExceeded
      ? formatFirestoreQuotaMessage(FIREBASE_PROJECT_ID, FIREBASE_DATABASE_ID)
      : rawMessage,
    quotaExceeded,
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (typeof window === 'undefined' || connectionTested) return true;
  connectionTested = true;
  try {
    const db = getFirestoreClient();
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration (Firestore client is offline).');
    }
    return false;
  }
}

// Defensive helpers matching firebase-blueprint.json constraints
export function clampString(value: unknown, maxLen: number, fallback = ''): string {
  const s = typeof value === 'string' ? value.trim() : value == null ? fallback : String(value).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function sanitizeDocId(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned || `doc_${Date.now()}`;
}
