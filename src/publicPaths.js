const PUBLIC_EXACT_PATHS = new Set(['/', '/health', '/status', '/api/accounts']);

export function isPublicPath(pathname) {
  return PUBLIC_EXACT_PATHS.has(pathname) || /^\/api\/accounts\/[^/]+\/usage$/.test(pathname);
}
