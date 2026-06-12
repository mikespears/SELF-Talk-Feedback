import { config } from './config.js';
import { getDb } from './db.js';
import { toUtcIso } from './time.js';

const MAX_BREAK_GAP_MS = 30 * 60 * 1000;

export function slotMatchesAt(slot, receivedAtIso, graceMinutes = config.matchGraceMinutes) {
  const atMs = Date.parse(toUtcIso(receivedAtIso));
  const graceMs = graceMinutes * 60_000;
  return (
    atMs >= Date.parse(slot.start_at) - graceMs
    && atMs < Date.parse(slot.end_at) + graceMs
  );
}

function slotInCore(slot, atMs) {
  return atMs >= Date.parse(slot.start_at) && atMs < Date.parse(slot.end_at);
}

function findSlotInShortBreak(slots, atMs) {
  for (let i = 0; i < slots.length - 1; i += 1) {
    const left = slots[i];
    const right = slots[i + 1];
    const leftEnd = Date.parse(left.end_at);
    const rightStart = Date.parse(right.start_at);
    const gapMs = rightStart - leftEnd;
    if (gapMs > 0 && gapMs <= MAX_BREAK_GAP_MS && atMs >= leftEnd && atMs < rightStart) {
      return left;
    }
  }
  return null;
}

/**
 * Find the talk slot active in a room at a given ISO timestamp.
 * Includes a grace window before start and after end, and counts short
 * scheduled breaks toward the talk that just ended.
 */
export function findActiveSlot(roomKey, receivedAtIso) {
  const slots = getDb()
    .prepare(
      `SELECT * FROM schedule_slots
       WHERE room_key = ?
       ORDER BY start_at ASC`,
    )
    .all(roomKey);

  const atMs = Date.parse(toUtcIso(receivedAtIso));

  const inCore = slots.filter((slot) => slotInCore(slot, atMs));
  if (inCore.length === 1) {
    return inCore[0];
  }
  if (inCore.length > 1) {
    return inCore.sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))[0];
  }

  const breakSlot = findSlotInShortBreak(slots, atMs);
  if (breakSlot) {
    return breakSlot;
  }

  const matching = slots.filter((slot) => slotMatchesAt(slot, receivedAtIso));
  if (!matching.length) {
    return null;
  }
  if (matching.length === 1) {
    return matching[0];
  }

  return matching.sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))[0];
}

export function rematchUnmatchedVotes() {
  const db = getDb();
  const unmatched = db.prepare('SELECT * FROM votes WHERE matched = 0').all();
  let updated = 0;

  const updateStmt = db.prepare(
    `UPDATE votes
     SET matched = 1, slot_id = ?, submission_code = ?, talk_title = ?
     WHERE id = ?`,
  );

  for (const vote of unmatched) {
    const slot = findActiveSlot(vote.room_key, vote.received_at);
    if (slot) {
      updateStmt.run(slot.id, slot.submission_code, slot.title, vote.id);
      updated += 1;
    }
  }

  return { checked: unmatched.length, updated };
}

export function rematchAllVotes() {
  const db = getDb();
  const votes = db.prepare('SELECT * FROM votes').all();
  let updated = 0;

  const updateStmt = db.prepare(
    `UPDATE votes
     SET matched = ?, slot_id = ?, submission_code = ?, talk_title = ?
     WHERE id = ?`,
  );

  for (const vote of votes) {
    const slot = findActiveSlot(vote.room_key, vote.received_at);
    const matched = slot ? 1 : 0;
    const slotId = slot?.id ?? null;
    const submissionCode = slot?.submission_code ?? null;
    const talkTitle = slot?.title ?? null;
    if (
      vote.matched !== matched
      || vote.slot_id !== slotId
      || vote.submission_code !== submissionCode
      || vote.talk_title !== talkTitle
    ) {
      updateStmt.run(matched, slotId, submissionCode, talkTitle, vote.id);
      updated += 1;
    }
  }

  return { checked: votes.length, updated };
}

export function recordVote({ roomKey, mqttTopic, voteType, rawPayload, receivedAtIso }) {
  const db = getDb();
  const slot = findActiveSlot(roomKey, receivedAtIso);

  const result = db
    .prepare(
      `INSERT INTO votes (
         received_at, mqtt_topic, room_key, vote_type, slot_id,
         submission_code, talk_title, matched, raw_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      toUtcIso(receivedAtIso),
      mqttTopic,
      roomKey,
      voteType,
      slot?.id ?? null,
      slot?.submission_code ?? null,
      slot?.title ?? null,
      slot ? 1 : 0,
      rawPayload,
    );

  return {
    voteId: result.lastInsertRowid,
    matched: Boolean(slot),
    slot,
  };
}

export function getVoteSummaryBySlot() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         s.id AS slot_id,
         s.submission_code,
         s.title,
         s.speakers,
         s.room_key,
         s.room_name,
         s.start_at,
         s.end_at,
         SUM(CASE WHEN v.vote_type = 'pos' THEN 1 ELSE 0 END) AS pos,
         SUM(CASE WHEN v.vote_type = 'neg' THEN 1 ELSE 0 END) AS neg,
         SUM(CASE WHEN v.vote_type = 'neutral' THEN 1 ELSE 0 END) AS neutral,
         COUNT(v.id) AS total_votes,
         SUM(CASE WHEN v.matched = 0 THEN 1 ELSE 0 END) AS unmatched_in_slot
       FROM schedule_slots s
       LEFT JOIN votes v ON v.slot_id = s.id
       GROUP BY s.id
       ORDER BY s.start_at ASC`,
    )
    .all();
}

export function getSpeakerReport(slotId) {
  const db = getDb();
  const slot = db.prepare('SELECT * FROM schedule_slots WHERE id = ?').get(slotId);
  if (!slot) {
    return null;
  }

  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN vote_type = 'pos' THEN 1 ELSE 0 END) AS pos,
         SUM(CASE WHEN vote_type = 'neg' THEN 1 ELSE 0 END) AS neg,
         SUM(CASE WHEN vote_type = 'neutral' THEN 1 ELSE 0 END) AS neutral,
         COUNT(*) AS total
       FROM votes WHERE slot_id = ?`,
    )
    .get(slotId);

  const hourly = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%d %H:00', received_at) AS hour,
         SUM(CASE WHEN vote_type = 'pos' THEN 1 ELSE 0 END) AS pos,
         SUM(CASE WHEN vote_type = 'neg' THEN 1 ELSE 0 END) AS neg,
         SUM(CASE WHEN vote_type = 'neutral' THEN 1 ELSE 0 END) AS neutral
       FROM votes
       WHERE slot_id = ?
       GROUP BY hour
       ORDER BY hour ASC`,
    )
    .all(slotId);

  return { slot, totals, hourly };
}

export function getUnmatchedVotes(limit = 100) {
  return getDb()
    .prepare(
      `SELECT * FROM votes
       WHERE matched = 0
       ORDER BY received_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function getLiveRoomStats() {
  const db = getDb();
  const now = toUtcIso(new Date());
  const byRoom = new Map();

  for (const roomKey of ['A', 'B', 'C', 'D']) {
    const slot = findActiveSlot(roomKey, now);
    if (slot) {
      byRoom.set(roomKey, slot);
    }
  }

  const activeSlots = [...byRoom.values()].sort((a, b) => a.room_key.localeCompare(b.room_key));

  return activeSlots.map((slot) => {
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN vote_type = 'pos' THEN 1 ELSE 0 END) AS pos,
           SUM(CASE WHEN vote_type = 'neg' THEN 1 ELSE 0 END) AS neg,
           SUM(CASE WHEN vote_type = 'neutral' THEN 1 ELSE 0 END) AS neutral,
           COUNT(*) AS total
         FROM votes WHERE slot_id = ?`,
      )
      .get(slot.id);
    return { slot, counts };
  });
}

export function getRecentVotes(limit = 50) {
  return getDb()
    .prepare(
      `SELECT v.*, s.title AS slot_title
       FROM votes v
       LEFT JOIN schedule_slots s ON s.id = v.slot_id
       ORDER BY v.received_at DESC
       LIMIT ?`,
    )
    .all(limit);
}
