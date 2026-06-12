import { getMeta, setMeta } from './db.js';

const META_KEY = 'telegram_settings';

function envDefaults() {
  return {
    enabled: process.env.TELEGRAM_ALERTS_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  };
}

function normalizeSettings(raw) {
  const defaults = envDefaults();
  if (!raw) {
    return { ...defaults };
  }

  return {
    enabled: raw.enabled === true || raw.enabled === 'true' || raw.enabled === 1 || raw.enabled === '1',
    botToken: raw.botToken != null ? String(raw.botToken).trim() : defaults.botToken,
    chatId: raw.chatId != null ? String(raw.chatId).trim() : defaults.chatId,
  };
}

export function validateTelegramSettings(input) {
  const settings = normalizeSettings(input);
  const errors = [];

  if (settings.enabled) {
    if (!settings.botToken) {
      errors.push('Bot token is required when Telegram alerts are enabled.');
    } else if (!/^\d+:[A-Za-z0-9_-]+$/.test(settings.botToken)) {
      errors.push('Bot token format looks invalid.');
    }

    if (!settings.chatId) {
      errors.push('Chat ID is required when Telegram alerts are enabled.');
    } else if (!/^-?\d+$/.test(settings.chatId) && !/^@[A-Za-z0-9_]{5,}$/.test(settings.chatId)) {
      errors.push('Chat ID must be a numeric ID or @channelusername.');
    }
  } else if (settings.botToken && !/^\d+:[A-Za-z0-9_-]+$/.test(settings.botToken)) {
    errors.push('Bot token format looks invalid.');
  }

  return { ok: errors.length === 0, errors, settings };
}

export function getTelegramSettings() {
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

export function getTelegramSettingsForDisplay() {
  const settings = getTelegramSettings();
  return {
    enabled: settings.enabled,
    chatId: settings.chatId,
    hasBotToken: Boolean(settings.botToken),
  };
}

export function saveTelegramSettings(input, { keepBotTokenIfBlank = true } = {}) {
  const current = getTelegramSettings();
  const merged = {
    ...input,
    enabled: input.enabled === true || input.enabled === 'true' || input.enabled === '1' || input.enabled === 'on',
    botToken:
      keepBotTokenIfBlank && !String(input.botToken ?? '').trim()
        ? current.botToken
        : String(input.botToken ?? '').trim(),
  };

  const result = validateTelegramSettings(merged);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  setMeta(META_KEY, JSON.stringify(result.settings));
  setMeta('telegram_settings_updated_at', new Date().toISOString());

  return { ok: true, settings: result.settings };
}

export function seedTelegramSettingsFromEnvIfMissing() {
  if (getMeta(META_KEY)) {
    return false;
  }

  const defaults = normalizeSettings(null);
  if (!defaults.botToken && !defaults.chatId && !defaults.enabled) {
    return false;
  }

  setMeta(META_KEY, JSON.stringify(defaults));
  return true;
}
