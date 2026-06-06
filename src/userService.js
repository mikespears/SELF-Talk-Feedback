import bcrypt from 'bcryptjs';
import { getDb } from './db.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateUsername(username) {
  const value = String(username ?? '').trim();
  if (!USERNAME_PATTERN.test(value)) {
    return 'Username must be 3–32 characters (letters, numbers, . _ -).';
  }
  return null;
}

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function listStaffUsers() {
  return getDb()
    .prepare(
      `SELECT id, username, created_at
       FROM staff_users
       ORDER BY username ASC`,
    )
    .all();
}

export function getStaffUserById(id) {
  return getDb()
    .prepare('SELECT id, username, created_at FROM staff_users WHERE id = ?')
    .get(id);
}

export function countStaffUsers() {
  return getDb().prepare('SELECT COUNT(*) AS count FROM staff_users').get().count;
}

export function createStaffUser({ username, password }) {
  const usernameError = validateUsername(username);
  if (usernameError) {
    return { ok: false, error: usernameError };
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }

  const normalized = String(username).trim();
  const existing = getDb()
    .prepare('SELECT id FROM staff_users WHERE username = ?')
    .get(normalized);
  if (existing) {
    return { ok: false, error: 'That username is already in use.' };
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const result = getDb()
    .prepare('INSERT INTO staff_users (username, password_hash) VALUES (?, ?)')
    .run(normalized, passwordHash);

  return { ok: true, user: getStaffUserById(result.lastInsertRowid) };
}

export function updateStaffUserPassword({ userId, password }) {
  const passwordError = validatePassword(password);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }

  const user = getStaffUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found.' };
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  getDb()
    .prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, userId);

  return { ok: true, user };
}

export function deleteStaffUser({ userId, currentUserId }) {
  if (Number(userId) === Number(currentUserId)) {
    return { ok: false, error: 'You cannot delete your own account while signed in.' };
  }

  if (countStaffUsers() <= 1) {
    return { ok: false, error: 'At least one staff account must remain.' };
  }

  const user = getStaffUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found.' };
  }

  getDb().prepare('DELETE FROM staff_users WHERE id = ?').run(userId);
  return { ok: true, user };
}

export function renameStaffUser({ userId, username, currentUserId }) {
  const usernameError = validateUsername(username);
  if (usernameError) {
    return { ok: false, error: usernameError };
  }

  const user = getStaffUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found.' };
  }

  const normalized = String(username).trim();
  const conflict = getDb()
    .prepare('SELECT id FROM staff_users WHERE username = ? AND id != ?')
    .get(normalized, userId);
  if (conflict) {
    return { ok: false, error: 'That username is already in use.' };
  }

  getDb().prepare('UPDATE staff_users SET username = ? WHERE id = ?').run(normalized, userId);

  const updated = getStaffUserById(userId);
  const sessionUpdate =
    Number(userId) === Number(currentUserId) ? { id: updated.id, username: updated.username } : null;

  return { ok: true, user: updated, sessionUpdate };
}
