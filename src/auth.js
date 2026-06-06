import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { getDb } from './db.js';

export function ensureStaffUser() {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM staff_users WHERE username = ?').get(config.staffUsername);
  if (existing) {
    return false;
  }

  const passwordHash = bcrypt.hashSync(config.staffPassword, 12);
  db.prepare('INSERT INTO staff_users (username, password_hash) VALUES (?, ?)').run(
    config.staffUsername,
    passwordHash,
  );
  return true;
}

export function verifyStaffCredentials(username, password) {
  const row = getDb()
    .prepare('SELECT id, username, password_hash FROM staff_users WHERE username = ?')
    .get(username);

  if (!row) {
    return null;
  }

  const valid = bcrypt.compareSync(password, row.password_hash);
  return valid ? { id: row.id, username: row.username } : null;
}

export function requireStaff(req, res, next) {
  if (req.session?.staffUser) {
    next();
    return;
  }

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const nextUrl = encodeURIComponent(req.originalUrl);
  res.redirect(`/login?next=${nextUrl}`);
}
