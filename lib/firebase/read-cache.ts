export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Lightweight short-TTL read cache to minimize redundant Firestore document reads
 * on the Spark (Free Tier) daily quota (50,000 reads/day).
 * Automatically invalidated on any write/mutation in the Firestore data gateway.
 */
export class FirestoreReadCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(defaultTtlMs = 25_000, maxEntries = 80) {
    this.defaultTtlMs = Math.max(0, defaultTtlMs);
    this.maxEntries = Math.max(10, maxEntries);
  }

  get<T>(key: string, now = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs, now = Date.now()): void {
    if (ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
  }

  invalidatePrefix(prefix: string): void {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error ?? '');
  const lower = text.toLowerCase();
  return (
    lower.includes('resource-exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('free daily read units') ||
    lower.includes('daily limit')
  );
}

export function formatFirestoreQuotaMessage(projectId?: string, databaseId?: string): string {
  const base =
    'Kuota harian gratis Firestore (Spark Plan) telah tercapai. Kuota akan direset otomatis pada hari berikutnya.';
  if (projectId && databaseId) {
    return `${base} Cek penggunaan di Firebase Console: https://console.firebase.google.com/project/${projectId}/firestore/databases/${databaseId}/data`;
  }
  return base;
}

export type DataBackendMode = 'firestore' | 'hybrid';

export function resolveDataBackendMode(rawValue: string | undefined): DataBackendMode {
  return (rawValue || '').trim().toLowerCase() === 'firestore' ? 'firestore' : 'hybrid';
}
