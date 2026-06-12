import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeVotePayload, roomKeyFromTopic } from '../src/config.js';
import { getDb, setMeta } from '../src/db.js';
import { findActiveSlot, recordVote, getVoteSummaryBySlot } from '../src/voteService.js';
import { positiveRate, summaryToCsv } from '../src/reports.js';
import {
  getMqttSettings,
  getMqttSettingsForDisplay,
  normalizeMqttUrl,
  saveMqttSettings,
} from '../src/mqttSettings.js';
import {
  buildSubmissionsApiUrl,
  getPretalxSettings,
  savePretalxSettings,
} from '../src/pretalxSettings.js';
import {
  createStaffUser,
  deleteStaffUser,
  renameStaffUser,
  listStaffUsers,
} from '../src/userService.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-feedback-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
process.env.PRETALX_ALLOWED_HOSTS = 'speakers.example.org,speakers.southeastlinuxfest.org';

describe('config helpers', () => {
  it('maps vote topics to room keys', () => {
    assert.equal(roomKeyFromTopic('vote/B'), 'B');
    assert.equal(roomKeyFromTopic('vote/a'), 'A');
    assert.equal(roomKeyFromTopic('other/B'), null);
  });

  it('normalizes vote payloads', () => {
    assert.equal(normalizeVotePayload('"pos"'), 'pos');
    assert.equal(normalizeVotePayload(' neutral '), 'neutral');
    assert.equal(normalizeVotePayload('natural'), 'neutral');
    assert.equal(normalizeVotePayload('invalid'), null);
  });
});

describe('vote matching', () => {
  const db = getDb();

  db.prepare(
    `INSERT OR REPLACE INTO schedule_slots (
      id, submission_code, title, speakers, room_key, pretalx_room_id,
      room_name, start_at, end_at, duration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    9001,
    'TEST01',
    'Test Talk',
    '["Test Speaker"]',
    'B',
    14,
    'Salon B',
    '2026-06-13T13:00:00.000Z',
    '2026-06-13T13:45:00.000Z',
    45,
  );

  it('finds active slot by room and time', () => {
    const slot = findActiveSlot('B', '2026-06-13T13:15:00.000Z');
    assert.equal(slot.submission_code, 'TEST01');
  });

  it('matches votes within grace window after slot end', () => {
    db.prepare(
      `INSERT OR REPLACE INTO schedule_slots (
        id, submission_code, title, speakers, room_key, pretalx_room_id,
        room_name, start_at, end_at, duration_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      9002,
      'FIRST',
      'First Talk',
      '[]',
      'C',
      15,
      'Salon C',
      '2026-06-12T14:00:00.000Z',
      '2026-06-12T14:45:00.000Z',
      45,
    );
    db.prepare(
      `INSERT OR REPLACE INTO schedule_slots (
        id, submission_code, title, speakers, room_key, pretalx_room_id,
        room_name, start_at, end_at, duration_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      9003,
      'SECOND',
      'Second Talk',
      '[]',
      'C',
      15,
      'Salon C',
      '2026-06-12T15:00:00.000Z',
      '2026-06-12T15:45:00.000Z',
      45,
    );

    assert.equal(findActiveSlot('C', '2026-06-12T14:48:00.000Z').submission_code, 'FIRST');
    assert.equal(findActiveSlot('C', '2026-06-12T14:51:15.000Z').submission_code, 'FIRST');
    assert.equal(findActiveSlot('C', '2026-06-12T14:55:00.000Z').submission_code, 'FIRST');
    assert.equal(findActiveSlot('C', '2026-06-12T14:55:13.818Z').submission_code, 'FIRST');
    assert.equal(findActiveSlot('C', '2026-06-12T15:00:00.000Z').submission_code, 'SECOND');

    db.prepare(
      `INSERT OR REPLACE INTO schedule_slots (
        id, submission_code, title, speakers, room_key, pretalx_room_id,
        room_name, start_at, end_at, duration_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      9004,
      'EARLY',
      'Early Talk',
      '[]',
      'A',
      13,
      'Salon A',
      '2026-06-12T12:00:00.000Z',
      '2026-06-12T12:45:00.000Z',
      45,
    );
    db.prepare(
      `INSERT OR REPLACE INTO schedule_slots (
        id, submission_code, title, speakers, room_key, pretalx_room_id,
        room_name, start_at, end_at, duration_minutes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      9005,
      'LATE',
      'Late Talk',
      '[]',
      'A',
      13,
      'Salon A',
      '2026-06-12T16:00:00.000Z',
      '2026-06-12T16:45:00.000Z',
      45,
    );
    assert.equal(findActiveSlot('A', '2026-06-12T14:00:00.000Z'), null);
  });

  it('records and aggregates votes', () => {
    getDb().prepare('DELETE FROM votes WHERE slot_id = ?').run(9001);

    recordVote({
      roomKey: 'B',
      mqttTopic: 'vote/B',
      voteType: 'pos',
      rawPayload: 'pos',
      receivedAtIso: '2026-06-13T13:15:00.000Z',
    });
    recordVote({
      roomKey: 'B',
      mqttTopic: 'vote/B',
      voteType: 'neg',
      rawPayload: 'neg',
      receivedAtIso: '2026-06-13T13:16:00.000Z',
    });

    const summary = getVoteSummaryBySlot().find((row) => row.slot_id === 9001);
    assert.equal(summary.pos, 1);
    assert.equal(summary.neg, 1);
    assert.equal(positiveRate({ pos: 1, neg: 1, neutral: 0 }), 50);
  });
});

describe('staff users', () => {
  it('creates, renames, and enforces delete rules', () => {
    const created = createStaffUser({ username: 'volunteer1', password: 'password123' });
    assert.equal(created.ok, true, created.error);

    const renamed = renameStaffUser({
      userId: created.user.id,
      username: 'volunteer-one',
      currentUserId: 999,
    });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.user.username, 'volunteer-one');

    const dup = createStaffUser({ username: 'volunteer-one', password: 'password123' });
    assert.equal(dup.ok, false);

    const blockSelf = deleteStaffUser({ userId: created.user.id, currentUserId: created.user.id });
    assert.equal(blockSelf.ok, false);

    assert.ok(listStaffUsers().length >= 1);
  });
});

describe('mqtt settings', () => {
  it('normalizes IPv6 broker URLs', () => {
    assert.equal(
      normalizeMqttUrl('2605:7b80:63:2:be24:11ff:fe36:63a2:1883'),
      'mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883',
    );
    assert.equal(
      normalizeMqttUrl('mqtt://2605:7b80:63:2:be24:11ff:fe36:63a2:1883'),
      'mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883',
    );
    assert.equal(
      normalizeMqttUrl('mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883'),
      'mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883',
    );
    assert.equal(
      normalizeMqttUrl('mqtt://broker.example.com:1883'),
      'mqtt://broker.example.com:1883',
    );
  });

  it('validates and persists settings', () => {
    const bad = saveMqttSettings({ url: 'not-a-url', topicPrefix: 'vote/', reconnectMs: 5000 });
    assert.equal(bad.ok, false);

    const saved = saveMqttSettings({
      url: 'mqtt://broker.example.com:1883',
      username: 'votebot',
      password: 'secret123',
      topicPrefix: 'vote',
      reconnectMs: 5000,
    });
    assert.equal(saved.ok, true);
    assert.equal(getMqttSettings().topicPrefix, 'vote/');
    assert.equal(getMqttSettings().password, 'secret123');

    const kept = saveMqttSettings({
      url: 'mqtt://broker.example.com:1883',
      username: 'votebot',
      password: '',
      topicPrefix: 'vote/',
      reconnectMs: 5000,
    }, { keepPasswordIfBlank: true });
    assert.equal(kept.ok, true);
    assert.equal(getMqttSettings().password, 'secret123');
    assert.equal(getMqttSettingsForDisplay().hasPassword, true);

    const ipv6 = saveMqttSettings({
      url: '2605:7b80:63:2:be24:11ff:fe36:63a2:1883',
      username: '',
      password: '',
      topicPrefix: 'vote/',
      reconnectMs: 5000,
    }, { keepPasswordIfBlank: true });
    assert.equal(ipv6.ok, true);
    assert.equal(
      getMqttSettings().url,
      'mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883',
    );
  });
});

describe('pretalx settings', () => {
  it('validates and builds api urls', () => {
    const bad = savePretalxSettings({ baseUrl: 'ftp://bad', eventSlug: 'ok', scheduleSyncIntervalMinutes: 60 });
    assert.equal(bad.ok, false);

    const saved = savePretalxSettings({
      baseUrl: 'https://speakers.example.org/',
      eventSlug: 'my-event-2026',
      scheduleSyncIntervalMinutes: 60,
    });
    assert.equal(saved.ok, true);
    assert.equal(getPretalxSettings().scheduleSyncIntervalMs, 3_600_000);
    assert.equal(getPretalxSettings().baseUrl, 'https://speakers.example.org');
    assert.match(
      buildSubmissionsApiUrl(),
      /https:\/\/speakers\.example\.org\/api\/events\/my-event-2026\/submissions/,
    );
  });
});

describe('reports', () => {
  it('exports csv with headers', () => {
    const csv = summaryToCsv([
      {
        submission_code: 'ABC',
        title: 'Talk, "quoted"',
        speakers: '["Speaker One"]',
        room_name: 'Salon B',
        start_at: '2026-06-13T09:00:00-04:00',
        end_at: '2026-06-13T09:45:00-04:00',
        pos: 2,
        neutral: 1,
        neg: 0,
        total_votes: 3,
      },
    ]);
    assert.match(csv, /^submission_code,/);
    assert.match(csv, /Talk, ""quoted""/);
  });
});
