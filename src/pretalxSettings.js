import { getMeta, setMeta } from './db.js';
import { assertSafePretalxUrl } from './security.js';

const META_KEY = 'pretalx_settings';

const MIN_SYNC_MINUTES = 1;
const MAX_SYNC_MINUTES = 1_440;

function envSyncIntervalMs() {
  if (process.env.SCHEDULE_SYNC_INTERVAL_MINUTES) {
    return Number(process.env.SCHEDULE_SYNC_INTERVAL_MINUTES) * 60_000;
  }
  if (process.env.SCHEDULE_SYNC_INTERVAL_MS) {
    return Number(process.env.SCHEDULE_SYNC_INTERVAL_MS);
  }
  return 60 * 60_000;
}

function envDefaults() {
  return {
    baseUrl: (process.env.PRETALX_BASE_URL || 'https://speakers.southeastlinuxfest.org').replace(/\/$/, ''),
    eventSlug: process.env.PRETALX_EVENT_SLUG || 'southeast-linux-fest-2026',
    scheduleSyncIntervalMs: envSyncIntervalMs(),
  };
}

function syncIntervalMsFromInput(raw, fallbackMs) {
  if (raw?.scheduleSyncIntervalMinutes != null && raw.scheduleSyncIntervalMinutes !== '') {
    return Number(raw.scheduleSyncIntervalMinutes) * 60_000;
  }
  if (raw?.scheduleSyncIntervalMs != null && raw.scheduleSyncIntervalMs !== '') {
    return Number(raw.scheduleSyncIntervalMs);
  }
  return fallbackMs;
}

function syncIntervalMinutesFromMs(ms) {
  return Math.round(ms / 60_000);
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
    scheduleSyncIntervalMs: syncIntervalMsFromInput(raw, defaults.scheduleSyncIntervalMs),
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

  try {
    assertSafePretalxUrl(settings.baseUrl);
  } catch (err) {
    errors.push(err.message);
  }

  const syncMinutes = syncIntervalMinutesFromMs(settings.scheduleSyncIntervalMs);
  if (
    !Number.isFinite(settings.scheduleSyncIntervalMs) ||
    syncMinutes < MIN_SYNC_MINUTES ||
    syncMinutes > MAX_SYNC_MINUTES
  ) {
    errors.push(`Sync interval must be between ${MIN_SYNC_MINUTES} and ${MAX_SYNC_MINUTES} minutes.`);
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
    scheduleSyncIntervalMinutes: syncIntervalMinutesFromMs(settings.scheduleSyncIntervalMs),
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
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Pretalx API error ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return { roomCount: data.count ?? data.results?.length ?? 0 };
}
