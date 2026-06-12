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
      vote_type TEXT NOT NULL CHECK (vote_type IN ('neutral', 'pos', 'neg')),
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

    CREATE TABLE IF NOT EXISTS uptime_sensors (
      sensor_key TEXT PRIMARY KEY,
      mqtt_topic TEXT NOT NULL,
      last_value REAL NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uptime_reboot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_key TEXT NOT NULL,
      mqtt_topic TEXT NOT NULL,
      previous_value REAL NOT NULL,
      new_value REAL NOT NULL,
      detected_at TEXT NOT NULL,
      acknowledged_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_uptime_reboots_unacked
      ON uptime_reboot_events (acknowledged_at, detected_at);
  `);

  migrateVoteTypesToNeutral(database);
}

function migrateVoteTypesToNeutral(database) {
  const done = database
    .prepare("SELECT value FROM app_meta WHERE key = 'vote_type_neutral_v1'")
    .get();
  if (done) {
    return;
  }

  const table = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'votes'")
    .get();
  if (!table?.sql?.includes("'natural'")) {
    database
      .prepare(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('vote_type_neutral_v1', '1')",
      )
      .run();
    return;
  }

  database.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE votes_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      mqtt_topic TEXT NOT NULL,
      room_key TEXT NOT NULL,
      vote_type TEXT NOT NULL CHECK (vote_type IN ('neutral', 'pos', 'neg')),
      slot_id INTEGER,
      submission_code TEXT,
      talk_title TEXT,
      matched INTEGER NOT NULL DEFAULT 0,
      raw_payload TEXT NOT NULL,
      FOREIGN KEY (slot_id) REFERENCES schedule_slots(id)
    );
    INSERT INTO votes_migrated (
      id, received_at, mqtt_topic, room_key, vote_type,
      slot_id, submission_code, talk_title, matched, raw_payload
    )
    SELECT
      id, received_at, mqtt_topic, room_key,
      CASE vote_type WHEN 'natural' THEN 'neutral' ELSE vote_type END,
      slot_id, submission_code, talk_title, matched, raw_payload
    FROM votes;
    DROP TABLE votes;
    ALTER TABLE votes_migrated RENAME TO votes;
    CREATE INDEX IF NOT EXISTS idx_votes_slot ON votes (slot_id);
    CREATE INDEX IF NOT EXISTS idx_votes_room_received ON votes (room_key, received_at);
    INSERT OR REPLACE INTO app_meta (key, value) VALUES ('vote_type_neutral_v1', '1');
    COMMIT;
    PRAGMA foreign_keys = ON;
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
