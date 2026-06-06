import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { getSpeakerReport, getVoteSummaryBySlot, getUnmatchedVotes } from './voteService.js';
import { getMeta } from './db.js';

export function createSpeakerReportToken({ slotId, submissionCode, createdBy }) {
  const token = uuidv4().replace(/-/g, '');
  getDb()
    .prepare(
      `INSERT INTO speaker_report_tokens (token, submission_code, slot_id, created_by)
       VALUES (?, ?, ?, ?)`,
    )
    .run(token, submissionCode, slotId, createdBy);
  return token;
}

export function getTokenRecord(token) {
  return getDb()
    .prepare(
      `SELECT * FROM speaker_report_tokens
       WHERE token = ? AND revoked_at IS NULL`,
    )
    .get(token);
}

export function revokeSpeakerReportToken(token) {
  getDb()
    .prepare(`UPDATE speaker_report_tokens SET revoked_at = datetime('now') WHERE token = ?`)
    .run(token);
}

export function listSpeakerReportTokens() {
  return getDb()
    .prepare(
      `SELECT t.*, s.title, s.start_at, s.room_name
       FROM speaker_report_tokens t
       JOIN schedule_slots s ON s.id = t.slot_id
       WHERE t.revoked_at IS NULL
       ORDER BY t.created_at DESC`,
    )
    .all();
}

export function buildStaffReportData() {
  const summary = getVoteSummaryBySlot();
  const unmatched = getUnmatchedVotes(500);
  const totals = summary.reduce(
    (acc, row) => {
      acc.pos += row.pos || 0;
      acc.neg += row.neg || 0;
      acc.natural += row.natural || 0;
      acc.total += row.total_votes || 0;
      return acc;
    },
    { pos: 0, neg: 0, natural: 0, total: 0 },
  );

  return {
    generatedAt: new Date().toISOString(),
    lastScheduleSync: getMeta('last_schedule_sync'),
    totals,
    unmatchedCount: unmatched.length,
    summary,
    unmatched,
  };
}

export function buildSpeakerReportData(slotId) {
  return getSpeakerReport(slotId);
}

export function summaryToCsv(summary) {
  const header = [
    'submission_code',
    'title',
    'speakers',
    'room',
    'start_at',
    'end_at',
    'positive',
    'neutral',
    'negative',
    'total_votes',
  ].join(',');

  const rows = summary.map((row) => {
    const speakers = JSON.parse(row.speakers || '[]').join('; ');
    const fields = [
      row.submission_code,
      row.title,
      speakers,
      row.room_name,
      row.start_at,
      row.end_at,
      row.pos || 0,
      row.natural || 0,
      row.neg || 0,
      row.total_votes || 0,
    ];
    return fields.map(csvEscape).join(',');
  });

  return [header, ...rows].join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function positiveRate(totals) {
  const total = (totals.pos || 0) + (totals.neg || 0) + (totals.natural || 0);
  if (!total) {
    return null;
  }
  return Math.round(((totals.pos || 0) / total) * 100);
}
