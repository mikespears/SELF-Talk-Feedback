import { getDb } from './db.js';

export function parseUptimeValue(rawPayload) {
  const trimmed = String(rawPayload ?? '').trim().replace(/^"|"$/g, '');
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/** MQTT topic filter match (+ single level, # multi-level suffix). */
export function topicMatchesPattern(topic, pattern) {
  const topicLevels = String(topic ?? '').trim().split('/');
  const patternLevels = String(pattern ?? '').trim().split('/');
  if (!topicLevels[0] || !patternLevels[0]) {
    return false;
  }

  let topicIndex = 0;
  for (let patternIndex = 0; patternIndex < patternLevels.length; patternIndex += 1) {
    const filter = patternLevels[patternIndex];
    if (filter === '#') {
      return patternIndex === patternLevels.length - 1;
    }
    if (topicIndex >= topicLevels.length) {
      return false;
    }
    if (filter !== '+' && filter !== topicLevels[topicIndex]) {
      return false;
    }
    topicIndex += 1;
  }

  return topicIndex === topicLevels.length;
}

export function sensorLabelFromTopic(topic) {
  const parts = String(topic).split('/');
  if (parts.length >= 4 && parts[1] === 'sensor' && parts[2] === 'uptime_sensor') {
    return parts[0];
  }
  if (parts.length > 1 && parts[parts.length - 1] === 'state') {
    return parts[0];
  }
  return parts.length > 1 ? parts[parts.length - 1] : topic;
}

export function recordUptimeReading({ topic, rawPayload, receivedAtIso = new Date().toISOString() }) {
  const value = parseUptimeValue(rawPayload);
  if (value === null) {
    return { ok: false, reason: 'invalid_payload' };
  }

  const db = getDb();
  const previous = db
    .prepare('SELECT last_value FROM uptime_sensors WHERE sensor_key = ?')
    .get(topic);

  let rebootEventId = null;
  if (previous && value < previous.last_value) {
    const result = db
      .prepare(
        `INSERT INTO uptime_reboot_events (
          sensor_key, mqtt_topic, previous_value, new_value, detected_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(topic, topic, previous.last_value, value, receivedAtIso);
    rebootEventId = result.lastInsertRowid;
  }

  db.prepare(
    `INSERT INTO uptime_sensors (sensor_key, mqtt_topic, last_value, last_seen_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sensor_key) DO UPDATE SET
       mqtt_topic = excluded.mqtt_topic,
       last_value = excluded.last_value,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`,
  ).run(topic, topic, value, receivedAtIso, receivedAtIso);

  return {
    ok: true,
    value,
    rebooted: rebootEventId !== null,
    rebootEventId,
    previousValue: previous?.last_value ?? null,
  };
}

export function listUptimeSensors() {
  return getDb()
    .prepare(
      `SELECT sensor_key, mqtt_topic, last_value, last_seen_at, updated_at
       FROM uptime_sensors
       ORDER BY sensor_key ASC`,
    )
    .all();
}

export function listUnacknowledgedReboots(limit = 20) {
  return getDb()
    .prepare(
      `SELECT id, sensor_key, mqtt_topic, previous_value, new_value, detected_at
       FROM uptime_reboot_events
       WHERE acknowledged_at IS NULL
       ORDER BY detected_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function listRecentReboots(limit = 50) {
  return getDb()
    .prepare(
      `SELECT id, sensor_key, mqtt_topic, previous_value, new_value, detected_at, acknowledged_at
       FROM uptime_reboot_events
       ORDER BY detected_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function acknowledgeRebootEvent(eventId) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE uptime_reboot_events
       SET acknowledged_at = datetime('now')
       WHERE id = ? AND acknowledged_at IS NULL`,
    )
    .run(eventId);
  return result.changes > 0;
}

export function getUptimeSummary() {
  const sensors = listUptimeSensors();
  const alerts = listUnacknowledgedReboots();
  return {
    sensorCount: sensors.length,
    unacknowledgedReboots: alerts.length,
    sensors,
    alerts,
  };
}
