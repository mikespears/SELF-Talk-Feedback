import express from 'express';
import { getMeta } from '../db.js';
import { syncScheduleFromPretalx, getScheduleStats } from '../pretalx.js';
import { reschedulePretalxSync } from '../pretalxSync.js';
import {
  getPretalxSettingsForDisplay,
  savePretalxSettings,
  testPretalxConnection,
} from '../pretalxSettings.js';
import { escapeHtml, formatDateTime, layout } from '../views.js';

const router = express.Router();

function redirectWithMessage(res, path, { error, success }) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (success) params.set('success', success);
  const query = params.toString();
  res.redirect(query ? `${path}?${query}` : path);
}

router.get('/', (req, res) => {
  const settings = getPretalxSettingsForDisplay();
  const schedule = getScheduleStats();
  const error = req.query.error ? String(req.query.error) : '';
  const success = req.query.success ? String(req.query.success) : '';

  const body = `
    <section class="toolbar">
      <div>
        <h1>Pretalx settings</h1>
        <p class="muted">Configure which Pretalx instance and event schedule to sync.</p>
      </div>
      <form method="post" action="/staff/pretalx/sync">
        <button type="submit" class="btn btn-secondary">Sync schedule now</button>
      </form>
    </section>

    ${error ? `<p class="error banner">${escapeHtml(error)}</p>` : ''}
    ${success ? `<p class="success banner">${escapeHtml(success)}</p>` : ''}

    <section class="status-grid">
      <div class="stat"><span>Cached slots</span><strong>${schedule.slotCount}</strong></div>
      <div class="stat"><span>Last sync</span><strong>${formatDateTime(getMeta('last_schedule_sync'))}</strong></div>
      <div class="stat"><span>Settings updated</span><strong>${formatDateTime(getMeta('pretalx_settings_updated_at'))}</strong></div>
      <div class="stat"><span>Auto-sync</span><strong>${Math.round(settings.scheduleSyncIntervalMs / 60_000)} min</strong></div>
    </section>

    <section class="grid two-col">
      <div class="panel">
        <h2>Connection</h2>
        <form method="post" action="/staff/pretalx" class="stack-form">
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
            Auto-sync interval (ms)
            <input type="number" name="scheduleSyncIntervalMs" required min="60000" max="86400000" step="60000"
                   value="${settings.scheduleSyncIntervalMs}">
          </label>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Save settings</button>
            <button type="submit" formaction="/staff/pretalx/test" class="btn btn-secondary">Test connection</button>
            <button type="submit" formaction="/staff/pretalx/save-sync" class="btn btn-secondary">Save and sync</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <h2>Endpoints</h2>
        <p class="muted">Public schedule:</p>
        <p><a href="${escapeHtml(settings.scheduleUrl)}" target="_blank" rel="noopener">${escapeHtml(settings.scheduleUrl)}</a></p>
        <p class="muted">API used for sync:</p>
        <p><code>${escapeHtml(settings.submissionsApiUrl)}</code></p>
        <p class="muted">Only rooms mapped to MQTT vote topics (A–D) are imported into this tool.</p>
      </div>
    </section>`;

  res.type('html').send(
    layout({ title: 'Pretalx settings', body, staffUser: req.session.staffUser, activeNav: 'pretalx' }),
  );
});

function parseFormSettings(body) {
  return {
    baseUrl: body.baseUrl,
    eventSlug: body.eventSlug,
    scheduleSyncIntervalMs: body.scheduleSyncIntervalMs,
  };
}

router.post('/', express.urlencoded({ extended: false }), (req, res) => {
  const result = savePretalxSettings(parseFormSettings(req.body));
  if (!result.ok) {
    redirectWithMessage(res, '/staff/pretalx', { error: result.errors.join(' ') });
    return;
  }

  reschedulePretalxSync();
  redirectWithMessage(res, '/staff/pretalx', { success: 'Pretalx settings saved.' });
});

router.post('/save-sync', express.urlencoded({ extended: false }), async (req, res) => {
  const result = savePretalxSettings(parseFormSettings(req.body));
  if (!result.ok) {
    redirectWithMessage(res, '/staff/pretalx', { error: result.errors.join(' ') });
    return;
  }

  reschedulePretalxSync();

  try {
    const sync = await syncScheduleFromPretalx();
    redirectWithMessage(res, '/staff/pretalx', {
      success: `Settings saved and synced ${sync.slotCount} schedule slots.`,
    });
  } catch (err) {
    redirectWithMessage(res, '/staff/pretalx', {
      error: `Settings saved but sync failed: ${err.message}`,
    });
  }
});

router.post('/test', express.urlencoded({ extended: false }), async (req, res) => {
  const result = savePretalxSettings(parseFormSettings(req.body));
  if (!result.ok) {
    redirectWithMessage(res, '/staff/pretalx', { error: result.errors.join(' ') });
    return;
  }

  try {
    const test = await testPretalxConnection(result.settings);
    redirectWithMessage(res, '/staff/pretalx', {
      success: `Connection OK — found ${test.roomCount} rooms in Pretalx.`,
    });
  } catch (err) {
    redirectWithMessage(res, '/staff/pretalx', { error: `Connection failed: ${err.message}` });
  }
});

router.post('/sync', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const sync = await syncScheduleFromPretalx();
    redirectWithMessage(res, '/staff/pretalx', {
      success: `Synced ${sync.slotCount} schedule slots from Pretalx.`,
    });
  } catch (err) {
    redirectWithMessage(res, '/staff/pretalx', { error: `Sync failed: ${err.message}` });
  }
});

export default router;
