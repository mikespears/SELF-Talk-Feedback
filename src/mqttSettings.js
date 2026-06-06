import { getMeta, setMeta } from './db.js';

const META_KEY = 'mqtt_settings';

function envDefaults() {
  return {
    url: process.env.MQTT_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'vote/',
    reconnectMs: Number(process.env.MQTT_RECONNECT_MS || 5_000),
  };
}

function normalizeSettings(raw) {
  const defaults = envDefaults();
  if (!raw) {
    return { ...defaults };
  }

  return {
    url: String(raw.url ?? defaults.url).trim(),
    username: String(raw.username ?? defaults.username).trim(),
    password: raw.password != null ? String(raw.password) : defaults.password,
    topicPrefix: normalizeTopicPrefix(raw.topicPrefix ?? defaults.topicPrefix),
    reconnectMs: Number(raw.reconnectMs ?? defaults.reconnectMs),
  };
}

function normalizeTopicPrefix(prefix) {
  const value = String(prefix ?? 'vote/').trim();
  return value.endsWith('/') ? value : `${value}/`;
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

  const defaults = envDefaults();
  setMeta(META_KEY, JSON.stringify(defaults));
  return true;
}
