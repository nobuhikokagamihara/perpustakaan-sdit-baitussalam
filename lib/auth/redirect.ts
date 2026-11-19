export function sanitizeRedirectPath(
  nextPath: string | null | undefined,
  fallback = '/'
): string {
  if (!nextPath || typeof nextPath !== 'string') return fallback;
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }
  if (trimmed === '/login' || trimmed.startsWith('/login?')) {
    return fallback;
  }
  return trimmed;
}

export function getDefaultRouteForRole(roleSlug: string): string {
  return roleSlug === 'anggota' ? '/catalog' : '/';
}

export function buildLoginHref(nextPath?: string | null): string {
  const safe = sanitizeRedirectPath(nextPath, '');
  if (!safe || safe === '/') return '/login';
  return `/login?next=${encodeURIComponent(safe)}`;
}
