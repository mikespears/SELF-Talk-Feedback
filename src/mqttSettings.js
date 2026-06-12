import { getMeta, setMeta } from './db.js';

const META_KEY = 'mqtt_settings';

const LEGACY_UPTIME_TOPICS = new Set([
  'uptime_sensor/#',
  'uptime_sensor',
  'uptime_sensor/+',
  'sensor/#',
  'sensor/+',
]);

function envDefaults() {
  return {
    url: process.env.MQTT_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'vote/',
    uptimeTopic: process.env.MQTT_UPTIME_TOPIC || '+/sensor/uptime_sensor/state',
    reconnectMs: Number(process.env.MQTT_RECONNECT_MS || 5_000),
  };
}

function normalizeTopicPrefix(prefix) {
  const value = String(prefix ?? 'vote/').trim();
  return value.endsWith('/') ? value : `${value}/`;
}

/** Bracket bare IPv6 hosts so mqtt:// and the Node URL parser work correctly. */
export function normalizeMqttUrl(input) {
  let url = String(input ?? '').trim();
  if (!url) {
    return url;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const looksLikeHost = url.startsWith('[')
      || url.includes('.')
      || /:[0-9a-f]/i.test(url);
    if (looksLikeHost) {
      url = `mqtt://${url}`;
    }
  }

  const match = url.match(/^(mqtts?:\/\/|wss?:\/\/)(.+)$/i);
  if (!match) {
    return url;
  }

  const scheme = match[1];
  let rest = match[2];

  const extra = rest.match(/^([^/?#]+)(.*)$/);
  if (!extra) {
    return url;
  }
  rest = extra[1];
  const suffix = extra[2];

  if (rest.startsWith('[')) {
    return `${scheme}${rest}${suffix}`;
  }

  if (!rest.includes(':')) {
    return `${scheme}${rest}${suffix}`;
  }

  const parts = rest.split(':');
  const last = parts[parts.length - 1];
  const hasNumericPort = /^\d+$/.test(last) && parts.length > 2;

  if (hasNumericPort) {
    const port = last;
    const host = parts.slice(0, -1).join(':');
    if (/^[0-9a-f:]+$/i.test(host) && host.includes(':')) {
      return `${scheme}[${host}]:${port}${suffix}`;
    }
    return `${scheme}${rest}${suffix}`;
  }

  if (/^[0-9a-f:]+$/i.test(rest) && parts.length >= 3) {
    return `${scheme}[${rest}]${suffix}`;
  }

  return `${scheme}${rest}${suffix}`;
}

function normalizeSettings(raw) {
  const defaults = envDefaults();
  if (!raw) {
    return {
      ...defaults,
      url: normalizeMqttUrl(defaults.url),
    };
  }

  return {
    url: normalizeMqttUrl(String(raw.url ?? defaults.url).trim()),
    username: String(raw.username ?? defaults.username).trim(),
    password: raw.password != null ? String(raw.password) : defaults.password,
    topicPrefix: normalizeTopicPrefix(raw.topicPrefix ?? defaults.topicPrefix),
    uptimeTopic: String(raw.uptimeTopic ?? defaults.uptimeTopic).trim() || defaults.uptimeTopic,
    reconnectMs: Number(raw.reconnectMs ?? defaults.reconnectMs),
  };
}

export function validateMqttSettings(input) {
  const settings = normalizeSettings(input);
  const errors = [];

  if (!/^(mqtt|mqtts|ws|wss):\/\/.+/i.test(settings.url)) {
    errors.push('Broker URL must start with mqtt://, mqtts://, ws://, or wss://.');
  }

  if (!settings.topicPrefix) {
    errors.push('Topic prefix is required.');
  }

  if (!settings.uptimeTopic) {
    errors.push('Uptime topic pattern is required.');
  }

  if (!Number.isFinite(settings.reconnectMs) || settings.reconnectMs < 1_000 || settings.reconnectMs > 60_000) {
    errors.push('Reconnect interval must be between 1000 and 60000 ms.');
  }

  return { ok: errors.length === 0, errors, settings };
}

export function getMqttSettings() {
  const stored = getMeta(META_KEY);
  if (!stored) {
    return normalizeSettings(null);
  }

  try {
    return normalizeSettings(JSON.parse(stored));
  } catch {
    return normalizeSettings(null);
  }
}

export function getMqttSettingsForDisplay() {
  const settings = getMqttSettings();
  return {
    url: settings.url,
    username: settings.username,
    topicPrefix: settings.topicPrefix,
    uptimeTopic: settings.uptimeTopic,
    reconnectMs: settings.reconnectMs,
    hasPassword: Boolean(settings.password),
  };
}

export function saveMqttSettings(input, { keepPasswordIfBlank = true } = {}) {
  const current = getMqttSettings();
  const merged = {
    ...input,
    password:
      keepPasswordIfBlank && !String(input.password ?? '').trim()
        ? current.password
        : String(input.password ?? ''),
  };

  const result = validateMqttSettings(merged);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  setMeta(META_KEY, JSON.stringify(result.settings));
  setMeta('mqtt_settings_updated_at', new Date().toISOString());

  return { ok: true, settings: result.settings };
}

export function seedMqttSettingsFromEnvIfMissing() {
  if (getMeta(META_KEY)) {
    return false;
  }

  const defaults = normalizeSettings(null);
  setMeta(META_KEY, JSON.stringify(defaults));
  return true;
}

const ESPHOME_UPTIME_TOPIC = '+/sensor/uptime_sensor/state';

/** ESPHome vote boxes use {device}/sensor/uptime_sensor/state. */
export function migrateLegacyUptimeTopicIfNeeded() {
  const stored = getMeta(META_KEY);
  if (!stored) {
    return false;
  }

  try {
    const raw = JSON.parse(stored);
    const topic = String(raw.uptimeTopic ?? '').trim();
    if (topic === ESPHOME_UPTIME_TOPIC) {
      return false;
    }
    if (topic && !LEGACY_UPTIME_TOPICS.has(topic)) {
      return false;
    }

    const settings = normalizeSettings({
      ...raw,
      uptimeTopic: ESPHOME_UPTIME_TOPIC,
    });
    setMeta(META_KEY, JSON.stringify(settings));
    setMeta('mqtt_settings_updated_at', new Date().toISOString());
    console.log(`Migrated MQTT uptime topic from "${topic || '(unset)'}" to ${ESPHOME_UPTIME_TOPIC}`);
    return true;
  } catch {
    return false;
  }
}
