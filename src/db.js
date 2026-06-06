import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;

export function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH
      ? path.isAbsolute(process.env.DATABASE_PATH)
        ? process.env.DATABASE_PATH
        : path.resolve(config.rootDir, process.env.DATABASE_PATH)
      : config.databasePath;
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_slots (
      id INTEGER PRIMARY KEY,
      submission_code TEXT NOT NULL,
      title TEXT NOT NULL,
      speakers TEXT NOT NULL DEFAULT '[]',
      room_key TEXT NOT NULL,
      pretalx_room_id INTEGER NOT NULL,
      room_name TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_schedule_slots_room_time
      ON schedule_slots (room_key, start_at, end_at);

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      mqtt_topic TEXT NOT NULL,
      room_key TEXT NOT NULL,
      vote_type TEXT NOT NULL CHECK (vote_type IN ('natural', 'pos', 'neg')),
      slot_id INTEGER,
      submission_code TEXT,
      talk_title TEXT,
      matched INTEGER NOT NULL DEFAULT 0,
      raw_payload TEXT NOT NULL,
      FOREIGN KEY (slot_id) REFERENCES schedule_slots(id)
    );

    CREATE INDEX IF NOT EXISTS idx_votes_slot ON votes (slot_id);
    CREATE INDEX IF NOT EXISTS idx_votes_room_received ON votes (room_key, received_at);

    CREATE TABLE IF NOT EXISTS speaker_report_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      submission_code TEXT NOT NULL,
      slot_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      revoked_at TEXT,
      FOREIGN KEY (slot_id) REFERENCES schedule_slots(id)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function setMeta(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row?.value ?? null;
}
