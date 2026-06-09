import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

/** Maps MQTT topic suffix (vote/A -> A) to Pretalx room IDs */
export const ROOM_MAP = {
  A: { pretalxRoomId: 13, label: 'Salon A (Altispeed Ballroom)' },
  B: { pretalxRoomId: 14, label: 'Salon B (Rocky Linux Ballroom)' },
  C: { pretalxRoomId: 15, label: 'Salon C-E (VictoriaMetrics Ballroom)' },
  D: { pretalxRoomId: 16, label: 'Piedmont 1-3 (TBD Ballroom)' },
};

export const VALID_VOTE_TYPES = ['natural', 'pos', 'neg'];

export const config = {
  port: Number(process.env.PORT || 3847),
  bindHost: process.env.BIND_HOST || '0.0.0.0',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(rootDir, process.env.DATABASE_PATH)
    : path.join(rootDir, 'data', 'feedback.db'),
  staffUsername: process.env.STAFF_USERNAME || 'staff',
  staffPassword: process.env.STAFF_PASSWORD || 'change-me',
  displayTimezone: process.env.DISPLAY_TIMEZONE || 'America/New_York',
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  viewsDir: path.join(rootDir, 'views'),
};

/** Secure cookies behind NPM: 'auto' uses X-Forwarded-Proto when trust proxy is set. */
export function resolveCookieSecure() {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }
  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }
  return process.env.NODE_ENV === 'production' ? 'auto' : false;
}

export function roomKeyFromTopic(topic, topicPrefix = 'vote/') {
  const prefix = topicPrefix;
  if (!topic.startsWith(prefix)) {
    return null;
  }
  const suffix = topic.slice(prefix.length).toUpperCase();
  return ROOM_MAP[suffix] ? suffix : null;
}

export function normalizeVotePayload(raw) {
  const value = String(raw).trim().toLowerCase().replace(/^"|"$/g, '');
  return VALID_VOTE_TYPES.includes(value) ? value : null;
}
