import { randomBytes, timingSafeEqual } from 'node:crypto';
import { escapeHtml } from './views.js';

const INSECURE_SECRETS = new Set([
  'dev-insecure-secret-change-me',
  'change-me',
  'change-me-to-a-long-random-string',
]);
export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32 || INSECURE_SECRETS.has(secret)) {
    throw new Error(
      'SESSION_SECRET must be a random string of at least 32 characters in production.',
    );
  }

  const staffPassword = process.env.STAFF_PASSWORD ?? '';
  if (staffPassword.length < 8 || INSECURE_SECRETS.has(staffPassword)) {
    throw new Error(
      'STAFF_PASSWORD must be at least 8 characters and not a placeholder in production.',
    );
  }
}

export function safeRedirectPath(next, fallback = '/staff') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  return next;
}

export function getCsrfToken(req) {
  if (!req.session) {
    return null;
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfInputHtml(req) {
  const token = getCsrfToken(req);
  if (!token) {
    return '';
  }
  return `<input type="hidden" name="_csrf" value="${escapeHtml(token)}">`;
}

export function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const provided = req.body?._csrf || req.headers['x-csrf-token'];
  if (!expected || !provided || !safeEqualString(String(provided), expected)) {
    if (req.path === '/login' && req.method === 'POST') {
      res.redirect('/login?error=csrf');
      return;
    }
    res.status(403).type('html').send('Invalid or missing CSRF token.');
    return;
  }
  next();
}

function safeEqualString(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function attachCsrfField(req, res, next) {
  req.csrfField = csrfInputHtml(req);
  next();
}

function parseHostname(urlString) {
  return new URL(urlString).hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateOrReservedHost(host) {
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

export function getPretalxAllowedHosts() {
  const raw = process.env.PRETALX_ALLOWED_HOSTS
    || 'speakers.southeastlinuxfest.org';
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

export function assertSafePretalxUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid Pretalx URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Pretalx URL must use http or https.');
  }

  const host = parseHostname(urlString);
  if (isPrivateOrReservedHost(host)) {
    throw new Error('Pretalx URL must not point to a private or local address.');
  }

  const allowed = getPretalxAllowedHosts();
  const hostAllowed = allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!hostAllowed) {
    throw new Error(`Pretalx host must be one of: ${allowed.join(', ')}`);
  }

  return url;
}
