import { getDb } from './db.js';
import { toUtcIso } from './time.js';

/**
 * Find the talk slot active in a room at a given ISO timestamp.
 */
export function findActiveSlot(roomKey, receivedAtIso) {
  const db = getDb();
  const at = toUtcIso(receivedAtIso);
  return db
    .prepare(
      `SELECT * FROM schedule_slots
       WHERE room_key = ?
         AND start_at <= ?
         AND end_at > ?
       ORDER BY start_at DESC
       LIMIT 1`,
    )
    .get(roomKey, at, at);
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
         SUM(CASE WHEN v.vote_type = 'natural' THEN 1 ELSE 0 END) AS natural,
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
         SUM(CASE WHEN vote_type = 'natural' THEN 1 ELSE 0 END) AS natural,
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
         SUM(CASE WHEN vote_type = 'natural' THEN 1 ELSE 0 END) AS natural
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

  const activeSlots = db
    .prepare(
      `SELECT * FROM schedule_slots
       WHERE start_at <= ? AND end_at > ?
       ORDER BY room_key ASC`,
    )
    .all(now, now);

  return activeSlots.map((slot) => {
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN vote_type = 'pos' THEN 1 ELSE 0 END) AS pos,
           SUM(CASE WHEN vote_type = 'neg' THEN 1 ELSE 0 END) AS neg,
           SUM(CASE WHEN vote_type = 'natural' THEN 1 ELSE 0 END) AS natural,
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
