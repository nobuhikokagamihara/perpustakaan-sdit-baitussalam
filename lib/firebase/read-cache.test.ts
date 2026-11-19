import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FirestoreReadCache,
  formatFirestoreQuotaMessage,
  isFirestoreQuotaError,
  resolveDataBackendMode,
} from './read-cache';

test('FirestoreReadCache returns cached entries before TTL and expires after TTL', () => {
  const cache = new FirestoreReadCache(10_000, 20);
  cache.set('col:books', [{ id: 'b1' }], 10_000, 1_000);

  assert.deepEqual(cache.get('col:books', 5_000), [{ id: 'b1' }]);
  assert.equal(cache.get('col:books', 11_000), undefined);
  assert.equal(cache.size(), 0);
});

test('FirestoreReadCache supports prefix invalidation and full clear on mutations', () => {
  const cache = new FirestoreReadCache(30_000, 20);
  cache.set('col:books:all', [1], 30_000, 100);
  cache.set('col:books:active', [2], 30_000, 100);
  cache.set('col:members:active', [3], 30_000, 100);

  cache.invalidatePrefix('col:books');
  assert.equal(cache.get('col:books:all', 200), undefined);
  assert.equal(cache.get('col:books:active', 200), undefined);
  assert.deepEqual(cache.get('col:members:active', 200), [3]);

  cache.clear();
  assert.equal(cache.size(), 0);
});

test('FirestoreReadCache evicts oldest entry when maxEntries is reached', () => {
  const cache = new FirestoreReadCache(30_000, 10);
  for (let i = 0; i < 12; i++) {
    cache.set(`k${i}`, i, 30_000, 100);
  }
  assert.equal(cache.size(), 10);
  assert.equal(cache.get('k0', 200), undefined);
  assert.equal(cache.get('k11', 200), 11);
});

test('isFirestoreQuotaError detects resource-exhausted and quota messages accurately', () => {
  assert.equal(isFirestoreQuotaError(new Error('FirebaseError: Quota exceeded.')), true);
  assert.equal(
    isFirestoreQuotaError(new Error('resource-exhausted: Free daily read units per project')),
    true
  );
  assert.equal(isFirestoreQuotaError(new Error('permission-denied')), false);

  const msg = formatFirestoreQuotaMessage('my-proj', '(default)');
  assert.ok(msg.includes('Spark Plan'));
  assert.ok(msg.includes('https://console.firebase.google.com/project/my-proj/firestore/databases/(default)/data'));
});

test('resolveDataBackendMode defaults safely to hybrid and enables firestore mode explicitly', () => {
  assert.equal(resolveDataBackendMode(undefined), 'hybrid');
  assert.equal(resolveDataBackendMode(''), 'hybrid');
  assert.equal(resolveDataBackendMode('hybrid'), 'hybrid');
  assert.equal(resolveDataBackendMode('firestore'), 'firestore');
  assert.equal(resolveDataBackendMode(' FIRESTORE '), 'firestore');
});
