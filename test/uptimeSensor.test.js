import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../src/db.js';
import {
  parseUptimeValue,
  topicMatchesPattern,
  recordUptimeReading,
  listUptimeSensors,
  listUnacknowledgedReboots,
  acknowledgeRebootEvent,
  getUptimeSummary,
} from '../src/uptimeSensor.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-uptime-test-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'uptime.db');

describe('uptime sensor', () => {
  const db = getDb();
  db.prepare('DELETE FROM uptime_reboot_events').run();
  db.prepare('DELETE FROM uptime_sensors').run();

  it('parses numeric uptime payloads', () => {
    assert.equal(parseUptimeValue('42'), 42);
    assert.equal(parseUptimeValue('"100"'), 100);
    assert.equal(parseUptimeValue(' 7 '), 7);
    assert.equal(parseUptimeValue(''), null);
    assert.equal(parseUptimeValue('abc'), null);
    assert.equal(parseUptimeValue('-1'), null);
  });

  it('matches mqtt topic patterns', () => {
    assert.equal(topicMatchesPattern('uptime_sensor', 'uptime_sensor'), true);
    assert.equal(topicMatchesPattern('uptime_sensor/device1', 'uptime_sensor/#'), true);
    assert.equal(topicMatchesPattern('uptime_sensor', 'uptime_sensor/#'), true);
    assert.equal(topicMatchesPattern('vote/A', 'uptime_sensor/#'), false);
    assert.equal(topicMatchesPattern('uptime_sensor/a/b', 'uptime_sensor/+'), false);
    assert.equal(topicMatchesPattern('uptime_sensor/a', 'uptime_sensor/+'), true);
    assert.equal(
      topicMatchesPattern('ballroomdvote/sensor/uptime_sensor/state', '+/sensor/uptime_sensor/state'),
      true,
    );
    assert.equal(
      topicMatchesPattern('ballroombvote/sensor/uptime_sensor/state', '+/sensor/uptime_sensor/state'),
      true,
    );
    assert.equal(
      topicMatchesPattern('ballroomdvote/sensor/uptime_sensor/state', 'uptime_sensor/#'),
      false,
    );
  });

  it('records increasing values without reboot events', () => {
    const first = recordUptimeReading({
      topic: 'uptime_sensor/booth-a',
      rawPayload: '10',
      receivedAtIso: '2026-06-05T10:00:00.000Z',
    });
    assert.equal(first.ok, true);
    assert.equal(first.rebooted, false);

    const second = recordUptimeReading({
      topic: 'uptime_sensor/booth-a',
      rawPayload: '15',
      receivedAtIso: '2026-06-05T10:05:00.000Z',
    });
    assert.equal(second.ok, true);
    assert.equal(second.rebooted, false);

    const sensors = listUptimeSensors();
    assert.equal(sensors.length, 1);
    assert.equal(sensors[0].last_value, 15);
    assert.equal(listUnacknowledgedReboots().length, 0);
  });

  it('detects reboot when counter decreases', () => {
    const reboot = recordUptimeReading({
      topic: 'uptime_sensor/booth-a',
      rawPayload: '3',
      receivedAtIso: '2026-06-05T10:10:00.000Z',
    });
    assert.equal(reboot.ok, true);
    assert.equal(reboot.rebooted, true);
    assert.equal(reboot.previousValue, 15);

    const alerts = listUnacknowledgedReboots();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].previous_value, 15);
    assert.equal(alerts[0].new_value, 3);

    const summary = getUptimeSummary();
    assert.equal(summary.unacknowledgedReboots, 1);
    assert.equal(summary.alerts[0].id, alerts[0].id);
  });

  it('acknowledges reboot alerts', () => {
    const [alert] = listUnacknowledgedReboots();
    assert.ok(alert);

    const ok = acknowledgeRebootEvent(alert.id);
    assert.equal(ok, true);
    assert.equal(listUnacknowledgedReboots().length, 0);
    assert.equal(acknowledgeRebootEvent(alert.id), false);
  });
});
