import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from './crypto';
import { buildLoginHref, getDefaultRouteForRole, sanitizeRedirectPath } from './redirect';

test('hashPassword and verifyPassword validate scrypt credentials accurately', () => {
  const hash = hashPassword('pustaka123');
  assert.equal(verifyPassword('pustaka123', hash), true);
  assert.equal(verifyPassword('salah123', hash), false);
  assert.equal(verifyPassword('pustaka123', 'invalid-format'), false);
});

test('signSessionToken and verifySessionToken reject tampered and expired tokens', () => {
  const validToken = signSessionToken({ userId: 3, exp: Date.now() + 60_000 });
  const decoded = verifySessionToken(validToken);
  assert.equal(decoded?.userId, 3);

  const [payloadPart, sigPart] = validToken.split('.');
  const tamperedToken = `${payloadPart}.${sigPart.slice(0, -1)}X`;
  assert.equal(verifySessionToken(tamperedToken), null);

  const expiredToken = signSessionToken({ userId: 3, exp: Date.now() - 1000 });
  assert.equal(verifySessionToken(expiredToken), null);
});

test('sanitizeRedirectPath prevents open redirects and preserves safe internal paths', () => {
  assert.equal(sanitizeRedirectPath('/books', '/'), '/books');
  assert.equal(sanitizeRedirectPath('/loans?status=Aktif', '/'), '/loans?status=Aktif');
  assert.equal(sanitizeRedirectPath('https://evil.example/phish', '/'), '/');
  assert.equal(sanitizeRedirectPath('//evil.example', '/'), '/');
  assert.equal(sanitizeRedirectPath('/\\evil.example', '/'), '/');
  assert.equal(sanitizeRedirectPath('/login', '/'), '/');
  assert.equal(sanitizeRedirectPath('/login?next=/books', '/'), '/');
  assert.equal(sanitizeRedirectPath('', '/catalog'), '/catalog');
});

test('getDefaultRouteForRole and buildLoginHref map roles and next paths cleanly', () => {
  assert.equal(getDefaultRouteForRole('anggota'), '/catalog');
  assert.equal(getDefaultRouteForRole('pustakawan'), '/');
  assert.equal(getDefaultRouteForRole('super_admin'), '/');
  assert.equal(buildLoginHref('/books'), '/login?next=%2Fbooks');
  assert.equal(buildLoginHref('/'), '/login');
  assert.equal(buildLoginHref('https://evil.com'), '/login');
});
