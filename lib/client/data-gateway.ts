'use client';

import type { FirebaseSessionActor } from '@/lib/firebase/library-store';
import { IS_FIRESTORE_ONLY_MODE } from '@/lib/firebase/client';

type LibraryStoreModule = typeof import('@/lib/firebase/library-store');
let libraryStorePromise: Promise<LibraryStoreModule> | null = null;
let loadedLibraryStore: LibraryStoreModule | null = null;

function loadLibraryStore(): Promise<LibraryStoreModule> {
  if (!libraryStorePromise) {
    libraryStorePromise = import('@/lib/firebase/library-store').then((mod) => {
      loadedLibraryStore = mod;
      return mod;
    });
  }
  return libraryStorePromise;
}

let activeFirebaseActor: FirebaseSessionActor | null = null;
let authReady = false;
let authReadyResolvers: Array<() => void> = [];

export function setGatewayFirebaseActor(actor: FirebaseSessionActor | null) {
  if (!actor || (activeFirebaseActor && activeFirebaseActor.uid !== actor.uid)) {
    loadedLibraryStore?.clearFirestoreReadCache();
  }
  activeFirebaseActor = actor;
}

export function getGatewayFirebaseActor(): FirebaseSessionActor | null {
  return activeFirebaseActor;
}

export function markGatewayAuthReady() {
  if (authReady) return;
  authReady = true;
  const resolvers = authReadyResolvers;
  authReadyResolvers = [];
  for (const resolve of resolvers) {
    resolve();
  }
}

export function waitForGatewayAuthReady(timeoutMs = 3000): Promise<void> {
  if (authReady || typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve();
    }, timeoutMs);
    authReadyResolvers.push(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}

function parseRequestBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

const LOCAL_TOKEN_KEY = 'lentera_local_session_v1';

export function setLocalSessionToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(LOCAL_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(LOCAL_TOKEN_KEY);
    }
  } catch {
    // ignore storage restriction errors
  }
}

export function getLocalSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LOCAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getLocalAuthHeaders(existingHeaders?: HeadersInit): Headers {
  const headers = new Headers(existingHeaders);
  const token = getLocalSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export async function gatewayFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();

  if (input.startsWith('/api/') && !input.startsWith('/api/auth/')) {
    await waitForGatewayAuthReady();
  }

  if (activeFirebaseActor && input.startsWith('/api/') && !input.startsWith('/api/auth/')) {
    const parsedBody = parseRequestBody(init?.body);
    const { dispatchFirestoreApi } = await loadLibraryStore();
    return dispatchFirestoreApi(input, method, parsedBody, activeFirebaseActor);
  }

  if (!activeFirebaseActor && IS_FIRESTORE_ONLY_MODE && method === 'GET' && input.startsWith('/api/catalog')) {
    try {
      const url = new URL(input, 'http://localhost:3000');
      const q = url.searchParams.get('q') || '';
      const categoryId = url.searchParams.get('categoryId') || '';
      const { fetchFirestoreCatalogPublic } = await loadLibraryStore();
      const fsData = await fetchFirestoreCatalogPublic(q, categoryId, false);
      if (fsData) {
        return new Response(JSON.stringify(fsData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ books: [], categories: [], newest: [], mostBorrowed: [] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Gagal terhubung ke Cloud Firestore. Periksa koneksi internet atau konfigurasi Firebase.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  if (!activeFirebaseActor && IS_FIRESTORE_ONLY_MODE && input.startsWith('/api/') && !input.startsWith('/api/health')) {
    return new Response(
      JSON.stringify({ error: 'Silakan masuk menggunakan akun Google terlebih dahulu.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!activeFirebaseActor && input.startsWith('/api/')) {
    const headers = getLocalAuthHeaders(init?.headers);
    return fetch(input, { ...init, headers });
  }

  return fetch(input, init);
}
