import express from 'express';
import { getMeta } from '../db.js';
import { getMqttStatus, restartMqttListener } from '../mqttClient.js';
import {
  getMqttSettingsForDisplay,
  saveMqttSettings,
} from '../mqttSettings.js';
import { escapeHtml, formatDateTime, layout } from '../views.js';
import { ROOM_MAP } from '../config.js';

const router = express.Router();

function redirectWithMessage(res, path, { error, success }) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (success) params.set('success', success);
  const query = params.toString();
  res.redirect(query ? `${path}?${query}` : path);
}

router.get('/', (req, res) => {
  const settings = getMqttSettingsForDisplay();
  const mqtt = getMqttStatus();
  const error = req.query.error ? String(req.query.error) : '';
  const success = req.query.success ? String(req.query.success) : '';

  const roomExamples = Object.keys(ROOM_MAP)
    .map((key) => `<li><code>${escapeHtml(settings.topicPrefix)}${key}</code> → Room ${key}</li>`)
    .join('');

  const body = `
    <section class="toolbar">
      <div>
        <h1>MQTT settings</h1>
        <p class="muted">Configure the vote button broker connection. Changes apply immediately and reconnect the listener.</p>
      </div>
      <form method="post" action="/staff/mqtt/reconnect">
        <button type="submit" class="btn btn-secondary">Reconnect now</button>
      </form>
    </section>

    ${error ? `<p class="error banner">${escapeHtml(error)}</p>` : ''}
    ${success ? `<p class="success banner">${escapeHtml(success)}</p>` : ''}

    <section class="status-grid">
      <div class="stat"><span>Status</span><strong class="${mqtt.connected ? 'ok' : 'warn'}">${mqtt.connected ? 'Connected' : 'Disconnected'}</strong></div>
      <div class="stat"><span>Broker</span><strong>${escapeHtml(mqtt.url)}</strong></div>
      <div class="stat"><span>Subscribe pattern</span><strong><code>${escapeHtml(mqtt.topicPrefix)}+</code></strong></div>
      <div class="stat"><span>Messages received</span><strong>${mqtt.messagesReceived}</strong></div>
      <div class="stat"><span>Last message</span><strong>${formatDateTime(mqtt.lastMessageAt)}</strong></div>
      <div class="stat"><span>Last updated</span><strong>${formatDateTime(getMeta('mqtt_settings_updated_at'))}</strong></div>
    </section>

    ${mqtt.lastError ? `<p class="error banner">Last error: ${escapeHtml(mqtt.lastError)}</p>` : ''}

    <section class="grid two-col">
      <div class="panel">
        <h2>Connection</h2>
        <form method="post" action="/staff/mqtt" class="stack-form">
          <label>
            Broker URL
            <input type="url" name="url" required value="${escapeHtml(settings.url)}"
                   placeholder="mqtt://broker.example.com:1883">
          </label>
          <label>
            Username
            <input type="text" name="username" value="${escapeHtml(settings.username)}" autocomplete="off">
          </label>
          <label>
            Password
            <input type="password" name="password" autocomplete="new-password"
                   placeholder="${settings.hasPassword ? 'Leave blank to keep current password' : 'Optional'}">
          </label>
          <label>
            Topic prefix
            <input type="text" name="topicPrefix" required value="${escapeHtml(settings.topicPrefix)}"
                   placeholder="vote/">
          </label>
          <label>
            Reconnect interval (ms)
            <input type="number" name="reconnectMs" required min="1000" max="60000" step="1000"
                   value="${settings.reconnectMs}">
          </label>
          <button type="submit" class="btn btn-primary">Save and reconnect</button>
        </form>
      </div>
      <div class="panel">
        <h2>Expected topics</h2>
        <p class="muted">The listener subscribes to <code>${escapeHtml(settings.topicPrefix)}+</code> (one level wildcard).</p>
        <ul>${roomExamples}</ul>
        <p class="muted">Valid payloads: <code>pos</code>, <code>neg</code>, <code>natural</code></p>
      </div>
    </section>`;

  res.type('html').send(
    layout({ title: 'MQTT settings', body, staffUser: req.session.staffUser, activeNav: 'mqtt' }),
  );
});

router.post('/', express.urlencoded({ extended: false }), (req, res) => {
  const result = saveMqttSettings({
    url: req.body.url,
    username: req.body.username,
    password: req.body.password,
    topicPrefix: req.body.topicPrefix,
    reconnectMs: req.body.reconnectMs,
  });

  if (!result.ok) {
    redirectWithMessage(res, '/staff/mqtt', { error: result.errors.join(' ') });
    return;
  }

  restartMqttListener(result.settings);
  redirectWithMessage(res, '/staff/mqtt', { success: 'MQTT settings saved. Reconnecting…' });
});

router.post('/reconnect', express.urlencoded({ extended: false }), (req, res) => {
  restartMqttListener();
  redirectWithMessage(res, '/staff/mqtt', { success: 'MQTT listener restarted.' });
});

export default router;
