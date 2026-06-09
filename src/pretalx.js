import { ROOM_MAP } from './config.js';
import { getDb, setMeta } from './db.js';
import { buildSubmissionsApiUrl } from './pretalxSettings.js';
import { assertSafePretalxUrl } from './security.js';
import { toUtcIso } from './time.js';

const FETCH_TIMEOUT_MS = 30_000;

async function fetchJson(url) {
  assertSafePretalxUrl(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Pretalx API error ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchAllSubmissions() {
  const results = [];
  let url = buildSubmissionsApiUrl();
  while (url) {
    const data = await fetchJson(url);
    results.push(...data.results);
    url = data.next;
  }

  return results;
}

function roomKeyFromPretalxRoomId(roomId) {
  for (const [key, info] of Object.entries(ROOM_MAP)) {
    if (info.pretalxRoomId === roomId) {
      return key;
    }
  }
  return null;
}

export async function syncScheduleFromPretalx() {
  const submissions = await fetchAllSubmissions();
  const db = getDb();

  const upsertStmt = db.prepare(`
    INSERT INTO schedule_slots (
      id, submission_code, title, speakers, room_key, pretalx_room_id,
      room_name, start_at, end_at, duration_minutes, synced_at
    ) VALUES (
      @id, @submission_code, @title, @speakers, @room_key, @pretalx_room_id,
      @room_name, @start_at, @end_at, @duration_minutes, datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      submission_code = excluded.submission_code,
      title = excluded.title,
      speakers = excluded.speakers,
      room_key = excluded.room_key,
      pretalx_room_id = excluded.pretalx_room_id,
      room_name = excluded.room_name,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      duration_minutes = excluded.duration_minutes,
      synced_at = datetime('now')
  `);

  const removeStaleStmt = db.prepare(`
    DELETE FROM schedule_slots
    WHERE id NOT IN (SELECT value FROM json_each(?))
      AND id NOT IN (SELECT DISTINCT slot_id FROM votes WHERE slot_id IS NOT NULL)
  `);

  const slots = [];

  for (const submission of submissions) {
    for (const slot of submission.slots || []) {
      const roomId = slot.room?.id;
      const roomKey = roomKeyFromPretalxRoomId(roomId);
      if (!roomKey) {
        continue;
      }

      slots.push({
        id: slot.id,
        submission_code: submission.code,
        title: submission.title,
        speakers: JSON.stringify(
          (submission.speakers || []).map((speaker) => speaker.name).filter(Boolean),
        ),
        room_key: roomKey,
        pretalx_room_id: roomId,
        room_name: slot.room?.name?.en || ROOM_MAP[roomKey].label,
        start_at: toUtcIso(slot.start),
        end_at: toUtcIso(slot.end),
        duration_minutes: slot.duration ?? submission.duration ?? 45,
      });
    }
  }

  const slotIds = slots.map((slot) => slot.id);

  const tx = db.transaction(() => {
    for (const slot of slots) {
      upsertStmt.run(slot);
    }
    if (slotIds.length) {
      removeStaleStmt.run(JSON.stringify(slotIds));
    }
  });
  tx();

  setMeta('last_schedule_sync', new Date().toISOString());
  setMeta('schedule_slot_count', String(slots.length));

  return { slotCount: slots.length, syncedAt: new Date().toISOString() };
}

export function getScheduleStats() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS count FROM schedule_slots').get().count;
  return { slotCount: count };
}

export function listScheduleSlots({ roomKey } = {}) {
  const db = getDb();
  if (roomKey) {
    return db
      .prepare(
        `SELECT * FROM schedule_slots
         WHERE room_key = ?
         ORDER BY start_at ASC`,
      )
      .all(roomKey);
  }
  return db
    .prepare('SELECT * FROM schedule_slots ORDER BY start_at ASC')
    .all();
}

export function getSlotById(slotId) {
  return getDb().prepare('SELECT * FROM schedule_slots WHERE id = ?').get(slotId);
}

export function getSlotBySubmissionCode(code) {
  return getDb()
    .prepare('SELECT * FROM schedule_slots WHERE submission_code = ? ORDER BY start_at ASC')
    .all(code);
}
