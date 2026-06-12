import { config } from './config.js';
import { getMeta, setMeta } from './db.js';
import { getTelegramSettings } from './telegramSettings.js';
import { formatDateTime } from './views.js';

const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;

export function formatRebootAlertMessage({
  sensorLabel,
  topic,
  previousValue,
  newValue,
  detectedAtIso,
}) {
  const time = formatDateTime(detectedAtIso);
  return [
    'Device reboot detected',
    '',
    `Sensor: ${sensorLabel}`,
    `Counter: ${previousValue} → ${newValue}`,
    `Time: ${time}`,
    `Topic: ${topic}`,
  ].join('\n');
}

export function isTelegramConfigured(settings = getTelegramSettings()) {
  return Boolean(settings.enabled && settings.botToken && settings.chatId);
}

export async function sendTelegramMessage(text, settings = getTelegramSettings()) {
  if (!settings.botToken || !settings.chatId) {
    throw new Error('Telegram bot token and chat ID are required.');
  }

  const url = `${TELEGRAM_API}/bot${settings.botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: settings.chatId,
      text: String(text),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const detail = payload?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram API error: ${detail}`);
  }

  setMeta('telegram_last_sent_at', new Date().toISOString());
  setMeta('telegram_last_error', '');

  return payload;
}

export async function sendTestTelegramMessage(settings = getTelegramSettings()) {
  const text = [
    'Test alert from SELF Talk Feedback',
    '',
    `Timezone: ${config.displayTimezone}`,
    `Time: ${formatDateTime(new Date().toISOString())}`,
  ].join('\n');
  return sendTelegramMessage(text, settings);
}

export async function notifyRebootAlert({
  sensorLabel,
  topic,
  previousValue,
  newValue,
  detectedAtIso,
}) {
  const settings = getTelegramSettings();
  if (!isTelegramConfigured(settings)) {
    return { sent: false, reason: 'disabled' };
  }

  const text = formatRebootAlertMessage({
    sensorLabel,
    topic,
    previousValue,
    newValue,
    detectedAtIso,
  });

  try {
    await sendTelegramMessage(text, settings);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Telegram reboot alert failed: ${message}`);
    setMeta('telegram_last_error', message);
    return { sent: false, reason: message };
  }
}
