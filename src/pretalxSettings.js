import { getMeta, setMeta } from './db.js';

const META_KEY = 'pretalx_settings';

function envDefaults() {
  return {
    baseUrl: (process.env.PRETALX_BASE_URL || 'https://speakers.southeastlinuxfest.org').replace(/\/$/, ''),
    eventSlug: process.env.PRETALX_EVENT_SLUG || 'southeast-linux-fest-2026',
    scheduleSyncIntervalMs: Number(process.env.SCHEDULE_SYNC_INTERVAL_MS || 3_600_000),
  };
}

function normalizeBaseUrl(url) {
  return String(url ?? '').trim().replace(/\/$/, '');
}

function normalizeSettings(raw) {
  const defaults = envDefaults();
  if (!raw) {
    return { ...defaults };
  }

  return {
    baseUrl: normalizeBaseUrl(raw.baseUrl ?? defaults.baseUrl),
    eventSlug: String(raw.eventSlug ?? defaults.eventSlug).trim(),
    scheduleSyncIntervalMs: Number(raw.scheduleSyncIntervalMs ?? defaults.scheduleSyncIntervalMs),
  };
}

export function validatePretalxSettings(input) {
  const settings = normalizeSettings(input);
  const errors = [];

  if (!/^https?:\/\/.+/i.test(settings.baseUrl)) {
    errors.push('Pretalx base URL must start with http:// or https://.');
  }

  if (!/^[a-z0-9-]+$/i.test(settings.eventSlug)) {
    errors.push('Event slug may only contain letters, numbers, and hyphens.');
  }

  if (
    !Number.isFinite(settings.scheduleSyncIntervalMs) ||
    settings.scheduleSyncIntervalMs < 60_000 ||
    settings.scheduleSyncIntervalMs > 86_400_000
  ) {
    errors.push('Sync interval must be between 60000 ms (1 min) and 86400000 ms (24 hr).');
  }

  return { ok: errors.length === 0, errors, settings };
}

export function getPretalxSettings() {
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

export function getPretalxSettingsForDisplay() {
  const settings = getPretalxSettings();
  return {
    baseUrl: settings.baseUrl,
    eventSlug: settings.eventSlug,
    scheduleSyncIntervalMs: settings.scheduleSyncIntervalMs,
    scheduleUrl: `${settings.baseUrl}/${settings.eventSlug}/schedule/`,
    submissionsApiUrl: buildSubmissionsApiUrl(settings),
  };
}

export function buildSubmissionsApiUrl(settings = getPretalxSettings()) {
  return `${settings.baseUrl}/api/events/${settings.eventSlug}/submissions/?expand=slots.room,speakers`;
}

export function savePretalxSettings(input) {
  const result = validatePretalxSettings(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  setMeta(META_KEY, JSON.stringify(result.settings));
  setMeta('pretalx_settings_updated_at', new Date().toISOString());

  return { ok: true, settings: result.settings };
}

export function seedPretalxSettingsFromEnvIfMissing() {
  if (getMeta(META_KEY)) {
    return false;
  }

  setMeta(META_KEY, JSON.stringify(envDefaults()));
  return true;
}

export async function testPretalxConnection(settings = getPretalxSettings()) {
  const url = `${settings.baseUrl}/api/events/${settings.eventSlug}/rooms/`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pretalx API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return { roomCount: data.count ?? data.results?.length ?? 0 };
}
