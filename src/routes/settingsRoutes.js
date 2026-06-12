import express from 'express';
import { ROOM_MAP } from '../config.js';
import { getMeta } from '../db.js';
import { getMqttStatus, restartMqttListener } from '../mqttClient.js';
import { saveMqttSettings, getMqttSettingsForDisplay } from '../mqttSettings.js';
import { syncScheduleFromPretalx, getScheduleStats } from '../pretalx.js';
import { reschedulePretalxSync } from '../pretalxSync.js';
import {
  getPretalxSettingsForDisplay,
  savePretalxSettings,
  testPretalxConnection,
} from '../pretalxSettings.js';
import { sendTestTelegramMessage } from '../telegram.js';
import {
  getTelegramSettingsForDisplay,
  saveTelegramSettings,
} from '../telegramSettings.js';
import { escapeHtml, formatDateTime, layout } from '../views.js';

const router = express.Router();
const BASE = '/staff/settings';

function redirectWithMessage(res, { section, error, success }) {
  const params = new URLSearchParams();
  if (section) params.set('section', section);
  if (error) params.set('error', error);
  if (success) params.set('success', success);
  res.redirect(`${BASE}?${params.toString()}`);
}

function renderMqttSection({ settings, mqtt, csrfField }) {
  const roomExamples = Object.keys(ROOM_MAP)
    .map((key) => `<li><code>${escapeHtml(settings.topicPrefix)}${key}</code> → Room ${key}</li>`)
    .join('');

  return `
    <section class="settings-section panel" id="mqtt">
      <div class="settings-section-header">
        <div>
          <h2>MQTT</h2>
          <p class="muted">Vote button broker connection. Saving reconnects the listener.</p>
        </div>
        <form method="post" action="${BASE}/mqtt/reconnect">
          ${csrfField}
          <button type="submit" class="btn btn-secondary">Reconnect now</button>
        </form>
      </div>

      <section class="status-grid compact">
        <div class="stat"><span>Status</span><strong class="${mqtt.connected ? 'ok' : 'warn'}">${mqtt.connected ? 'Connected' : 'Disconnected'}</strong></div>
        <div class="stat"><span>Broker</span><strong>${escapeHtml(mqtt.url)}</strong></div>
        <div class="stat"><span>Subscribe pattern</span><strong><code>${escapeHtml(mqtt.topicPrefix)}+</code></strong></div>
        <div class="stat"><span>Uptime topic</span><strong><code>${escapeHtml(mqtt.uptimeTopic)}</code></strong></div>
        <div class="stat"><span>Messages</span><strong>${mqtt.messagesReceived}</strong></div>
        <div class="stat"><span>Last message</span><strong>${formatDateTime(mqtt.lastMessageAt)}</strong></div>
        <div class="stat"><span>Updated</span><strong>${formatDateTime(getMeta('mqtt_settings_updated_at'))}</strong></div>
      </section>

      ${mqtt.lastError ? `<p class="error banner">Last error: ${escapeHtml(mqtt.lastError)}</p>` : ''}
      ${mqtt.lastError && /not authorized/i.test(mqtt.lastError) ? '<p class="error banner">The broker rejected the login. Enter the MQTT username and password below, then click <strong>Save and reconnect</strong>.</p>' : ''}

      <div class="grid two-col">
        <div>
          <h3>Connection</h3>
          <form method="post" action="${BASE}/mqtt" class="stack-form">
            ${csrfField}
            <label>
              Broker URL
              <input type="text" name="url" required value="${escapeHtml(settings.url)}"
                     placeholder="mqtt://[2605:7b80:63:2:be24:11ff:fe36:63a2]:1883"
                     spellcheck="false">
              <p class="muted hint">IPv6 brokers must use brackets, e.g. <code>mqtt://[addr]:1883</code>. Bare IPv6 with a trailing port is accepted too.</p>
            </label>
            <label>
              Username
              <input type="text" name="username" value="${escapeHtml(settings.username)}" autocomplete="off"
                     placeholder="Required if broker uses authentication">
            </label>
            <label>
              Password
              <input type="password" name="password" autocomplete="new-password"
                     placeholder="${settings.hasPassword ? 'Leave blank to keep current password' : 'Required if broker uses authentication'}">
            </label>
            <label>
              Topic prefix
              <input type="text" name="topicPrefix" required value="${escapeHtml(settings.topicPrefix)}"
                     placeholder="vote/">
            </label>
            <label>
              Uptime sensor topic
              <input type="text" name="uptimeTopic" required value="${escapeHtml(settings.uptimeTopic)}"
                     placeholder="+/sensor/uptime_sensor/state">
              <p class="muted hint">ESPHome devices publish to <code>ballroomdvote/sensor/uptime_sensor/state</code>. Use <code>+/sensor/uptime_sensor/state</code> for all vote boxes, or <code>ballroomdvote/sensor/uptime_sensor/state</code> for one device.</p>
            </label>
            <label>
              Reconnect interval (ms)
              <input type="number" name="reconnectMs" required min="1000" max="60000" step="1000"
                     value="${settings.reconnectMs}">
            </label>
            <button type="submit" class="btn btn-primary">Save and reconnect</button>
          </form>
        </div>
        <div>
          <h3>Expected topics</h3>
          <p class="muted">Subscribes to <code>${escapeHtml(settings.topicPrefix)}+</code> (one level wildcard).</p>
          <ul>${roomExamples}</ul>
          <p class="muted">Valid vote payloads: <code>pos</code>, <code>neg</code>, <code>neutral</code> (legacy <code>natural</code> is also accepted)</p>
          <p class="muted">Uptime payloads: increasing numeric counter (reboot detected when value drops).</p>
        </div>
      </div>
    </section>`;
}

function renderTelegramSection({ settings, csrfField }) {
  const configured = settings.enabled && settings.hasBotToken && Boolean(settings.chatId);

  return `
    <section class="settings-section panel" id="telegram">
      <div class="settings-section-header">
        <div>
          <h2>Telegram alerts</h2>
          <p class="muted">Send a Telegram message when an uptime sensor counter drops (device reboot).</p>
        </div>
      </div>

      <section class="status-grid compact">
        <div class="stat"><span>Status</span><strong class="${configured ? 'ok' : ''}">${configured ? 'Enabled' : 'Off'}</strong></div>
        <div class="stat"><span>Chat ID</span><strong>${settings.chatId ? escapeHtml(settings.chatId) : '—'}</strong></div>
        <div class="stat"><span>Bot token</span><strong>${settings.hasBotToken ? 'Saved' : '—'}</strong></div>
        <div class="stat"><span>Last sent</span><strong>${formatDateTime(getMeta('telegram_last_sent_at'))}</strong></div>
        <div class="stat"><span>Updated</span><strong>${formatDateTime(getMeta('telegram_settings_updated_at'))}</strong></div>
      </section>

      ${getMeta('telegram_last_error') ? `<p class="error banner">Last error: ${escapeHtml(getMeta('telegram_last_error'))}</p>` : ''}

      <div class="grid two-col">
        <div>
          <h3>Connection</h3>
          <form method="post" action="${BASE}/telegram" class="stack-form">
            ${csrfField}
            <label class="checkbox-label">
              <input type="checkbox" name="enabled" value="1" ${settings.enabled ? 'checked' : ''}>
              Enable Telegram reboot alerts
            </label>
            <label>
              Bot token
              <input type="password" name="botToken" autocomplete="new-password"
                     placeholder="${settings.hasBotToken ? 'Leave blank to keep current token' : '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'}">
            </label>
            <label>
              Chat ID
              <input type="text" name="chatId" value="${escapeHtml(settings.chatId)}"
                     placeholder="-1001234567890 or @your_channel"
                     spellcheck="false">
            </label>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Save Telegram settings</button>
              <button type="submit" formaction="${BASE}/telegram/test" class="btn btn-secondary">Send test message</button>
            </div>
          </form>
        </div>
        <div>
          <h3>Setup</h3>
          <ol class="muted setup-steps">
            <li>Message <code>@BotFather</code> on Telegram and create a bot. Copy the bot token.</li>
            <li>Start a chat with your bot (or add it to a group/channel).</li>
            <li>Use <code>@userinfobot</code> or <code>@getidsbot</code> to find your chat ID, or add the bot to a group and read updates from the Bot API.</li>
            <li>Paste the token and chat ID here, enable alerts, and send a test message.</li>
          </ol>
          <p class="muted">Alerts are sent in addition to the staff dashboard banner.</p>
        </div>
      </div>
    </section>`;
}

function renderPretalxSection({ settings, schedule, csrfField }) {
  return `
    <section class="settings-section panel" id="pretalx">
      <div class="settings-section-header">
        <div>
          <h2>Pretalx</h2>
          <p class="muted">Schedule source for talk matching and reports.</p>
        </div>
        <form method="post" action="${BASE}/pretalx/sync">
          ${csrfField}
          <button type="submit" class="btn btn-secondary">Sync schedule now</button>
        </form>
      </div>

      <section class="status-grid compact">
        <div class="stat"><span>Cached slots</span><strong>${schedule.slotCount}</strong></div>
        <div class="stat"><span>Last sync</span><strong>${formatDateTime(getMeta('last_schedule_sync'))}</strong></div>
        <div class="stat"><span>Updated</span><strong>${formatDateTime(getMeta('pretalx_settings_updated_at'))}</strong></div>
        <div class="stat"><span>Auto-sync</span><strong>${settings.scheduleSyncIntervalMinutes} min</strong></div>
      </section>

      <div class="grid two-col">
        <div>
          <h3>Connection</h3>
          <form method="post" action="${BASE}/pretalx" class="stack-form">
            ${csrfField}
            <label>
              Pretalx base URL
              <input type="url" name="baseUrl" required value="${escapeHtml(settings.baseUrl)}"
                     placeholder="https://speakers.example.org">
            </label>
            <label>
              Event slug
              <input type="text" name="eventSlug" required pattern="[A-Za-z0-9-]+"
                     value="${escapeHtml(settings.eventSlug)}"
                     placeholder="southeast-linux-fest-2026">
            </label>
            <label>
              Auto-sync interval (minutes)
              <input type="number" name="scheduleSyncIntervalMinutes" required min="1" max="1440" step="1"
                     value="${settings.scheduleSyncIntervalMinutes}">
            </label>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Save settings</button>
              <button type="submit" formaction="${BASE}/pretalx/test" class="btn btn-secondary">Test connection</button>
              <button type="submit" formaction="${BASE}/pretalx/save-sync" class="btn btn-secondary">Save and sync</button>
            </div>
          </form>
        </div>
        <div>
          <h3>Endpoints</h3>
          <p class="muted">Public schedule:</p>
          <p><a href="${escapeHtml(settings.scheduleUrl)}" target="_blank" rel="noopener">${escapeHtml(settings.scheduleUrl)}</a></p>
          <p class="muted">API used for sync:</p>
          <p><code>${escapeHtml(settings.submissionsApiUrl)}</code></p>
          <p class="muted">Only rooms mapped to MQTT vote topics (A–D) are imported.</p>
        </div>
      </div>
    </section>`;
}

router.get('/', (req, res) => {
  const error = req.query.error ? String(req.query.error) : '';
  const success = req.query.success ? String(req.query.success) : '';
  const section = req.query.section ? String(req.query.section) : '';

  const body = `
    <section class="toolbar">
      <div>
        <h1>Settings</h1>
        <p class="muted">Configure MQTT vote capture, Telegram reboot alerts, and Pretalx schedule sync.</p>
      </div>
      <nav class="section-jumps">
        <a href="#mqtt">MQTT</a>
        <a href="#telegram">Telegram</a>
        <a href="#pretalx">Pretalx</a>
      </nav>
    </section>

    ${error ? `<p class="error banner">${escapeHtml(error)}</p>` : ''}
    ${success ? `<p class="success banner">${escapeHtml(success)}</p>` : ''}

    ${renderMqttSection({
      settings: getMqttSettingsForDisplay(),
      mqtt: getMqttStatus(),
      csrfField: req.csrfField,
    })}
    ${renderTelegramSection({
      settings: getTelegramSettingsForDisplay(),
      csrfField: req.csrfField,
    })}
    ${renderPretalxSection({
      settings: getPretalxSettingsForDisplay(),
      schedule: getScheduleStats(),
      csrfField: req.csrfField,
    })}

    <script src="/js/settings.js"></script>
    ${section ? `<script>window.settingsSection = ${JSON.stringify(section)};</script>` : ''}`;

  res.type('html').send(
    layout({
      title: 'Settings',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'settings',
      csrfField: req.csrfField,
    }),
  );
});

router.post('/mqtt', express.urlencoded({ extended: false }), (req, res) => {
  const result = saveMqttSettings({
    url: req.body.url,
    username: req.body.username,
    password: req.body.password,
    topicPrefix: req.body.topicPrefix,
    uptimeTopic: req.body.uptimeTopic,
    reconnectMs: req.body.reconnectMs,
  });

  if (!result.ok) {
    redirectWithMessage(res, { section: 'mqtt', error: result.errors.join(' ') });
    return;
  }

  restartMqttListener(result.settings);
  redirectWithMessage(res, { section: 'mqtt', success: 'MQTT settings saved. Reconnecting…' });
});

router.post('/mqtt/reconnect', express.urlencoded({ extended: false }), (req, res) => {
  restartMqttListener();
  redirectWithMessage(res, { section: 'mqtt', success: 'MQTT listener restarted.' });
});

function parseTelegramForm(body) {
  return {
    enabled: body.enabled === '1',
    botToken: body.botToken,
    chatId: body.chatId,
  };
}

router.post('/telegram', express.urlencoded({ extended: false }), (req, res) => {
  const result = saveTelegramSettings(parseTelegramForm(req.body));
  if (!result.ok) {
    redirectWithMessage(res, { section: 'telegram', error: result.errors.join(' ') });
    return;
  }

  redirectWithMessage(res, { section: 'telegram', success: 'Telegram settings saved.' });
});

router.post('/telegram/test', express.urlencoded({ extended: false }), async (req, res) => {
  const result = saveTelegramSettings(parseTelegramForm(req.body));
  if (!result.ok) {
    redirectWithMessage(res, { section: 'telegram', error: result.errors.join(' ') });
    return;
  }

  if (!result.settings.enabled) {
    redirectWithMessage(res, {
      section: 'telegram',
      error: 'Enable Telegram alerts before sending a test message.',
    });
    return;
  }

  try {
    await sendTestTelegramMessage(result.settings);
    redirectWithMessage(res, { section: 'telegram', success: 'Test message sent to Telegram.' });
  } catch (err) {
    redirectWithMessage(res, {
      section: 'telegram',
      error: err instanceof Error ? err.message : 'Test message failed.',
    });
  }
});

function parsePretalxForm(body) {
  return {
    baseUrl: body.baseUrl,
    eventSlug: body.eventSlug,
    scheduleSyncIntervalMinutes: body.scheduleSyncIntervalMinutes,
  };
}

router.post('/pretalx', express.urlencoded({ extended: false }), (req, res) => {
  const result = savePretalxSettings(parsePretalxForm(req.body));
  if (!result.ok) {
    redirectWithMessage(res, { section: 'pretalx', error: result.errors.join(' ') });
    return;
  }

  reschedulePretalxSync();
  redirectWithMessage(res, { section: 'pretalx', success: 'Pretalx settings saved.' });
});

router.post('/pretalx/save-sync', express.urlencoded({ extended: false }), async (req, res) => {
  const result = savePretalxSettings(parsePretalxForm(req.body));
  if (!result.ok) {
    redirectWithMessage(res, { section: 'pretalx', error: result.errors.join(' ') });
    return;
  }

  reschedulePretalxSync();

  try {
    const sync = await syncScheduleFromPretalx();
    redirectWithMessage(res, {
      section: 'pretalx',
      success: `Settings saved and synced ${sync.slotCount} schedule slots.`,
    });
  } catch (err) {
    redirectWithMessage(res, {
      section: 'pretalx',
      error: 'Settings saved but sync failed. Check server logs.',
    });
  }
});

router.post('/pretalx/test', express.urlencoded({ extended: false }), async (req, res) => {
  const result = savePretalxSettings(parsePretalxForm(req.body));
  if (!result.ok) {
    redirectWithMessage(res, { section: 'pretalx', error: result.errors.join(' ') });
    return;
  }

  try {
    const test = await testPretalxConnection(result.settings);
    redirectWithMessage(res, {
      section: 'pretalx',
      success: `Connection OK — found ${test.roomCount} rooms in Pretalx.`,
    });
  } catch (err) {
    redirectWithMessage(res, { section: 'pretalx', error: 'Connection test failed. Check server logs.' });
  }
});

router.post('/pretalx/sync', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const sync = await syncScheduleFromPretalx();
    redirectWithMessage(res, {
      section: 'pretalx',
      success: `Synced ${sync.slotCount} schedule slots from Pretalx.`,
    });
  } catch (err) {
    redirectWithMessage(res, { section: 'pretalx', error: 'Sync failed. Check server logs.' });
  }
});

export default router;
