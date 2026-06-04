const rawBasePath = import.meta.env.BASE_URL || '/';

export const appBasePath = normalizeBasePath(rawBasePath);

export function withBasePath(path) {
  if (!path || typeof path !== 'string') return path;
  if (!appBasePath) return path;
  if (/^(https?:|data:|blob:|#)/i.test(path)) return path;
  if (!path.startsWith('/')) return path;
  if (path === appBasePath || path.startsWith(`${appBasePath}/`)) return path;
  return `${appBasePath}${path}`;
}

function normalizeBasePath(value) {
  const clean = String(value || '/').trim();
  if (!clean || clean === '/') return '';
  return `/${clean.replace(/^\/+|\/+$/g, '')}`;
}
