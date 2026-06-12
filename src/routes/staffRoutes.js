import express from 'express';
import { requireStaff } from '../auth.js';
import { getMeta } from '../db.js';
import { getMqttStatus } from '../mqttClient.js';
import { syncScheduleFromPretalx, getScheduleStats, listScheduleSlots, getSlotById } from '../pretalx.js';
import {
  buildStaffReportData,
  buildSpeakerReportData,
  createSpeakerReportToken,
  listSpeakerReportTokens,
  revokeSpeakerReportToken,
  summaryToCsv,
  positiveRate,
} from '../reports.js';
import {
  getLiveRoomStats,
  getRecentVotes,
  getVoteSummaryBySlot,
} from '../voteService.js';
import {
  getUptimeSummary,
  listRecentReboots,
  acknowledgeRebootEvent,
  sensorLabelFromTopic,
} from '../uptimeSensor.js';
import { escapeHtml, formatDateTime, layout, parseSpeakers, voteBar, voteTypeLabel } from '../views.js';
import { ROOM_MAP } from '../config.js';
import { getCsrfToken, requireCsrf } from '../security.js';
import userRoutes from './userRoutes.js';
import settingsRoutes from './settingsRoutes.js';

const router = express.Router();
router.use(requireStaff);
router.use((req, res, next) => {
  if (req.method === 'POST') {
    requireCsrf(req, res, next);
    return;
  }
  next();
});
router.use('/users', userRoutes);
router.use('/settings', settingsRoutes);

router.get('/mqtt', (req, res) => {
  res.redirect(301, '/staff/settings#mqtt');
});

router.get('/pretalx', (req, res) => {
  res.redirect(301, '/staff/settings#pretalx');
});

router.get('/', (req, res) => {
  const live = getLiveRoomStats();
  const recent = getRecentVotes(20);
  const mqtt = getMqttStatus();
  const schedule = getScheduleStats();
  const uptime = getUptimeSummary();
  const recentReboots = listRecentReboots(10);

  const alertBanner = uptime.alerts.length
    ? `<div id="uptime-alert-banner" class="banner alert-banner" role="alert">
        <strong>Device reboot detected</strong>
        <ul id="uptime-alert-list" class="alert-list">
          ${uptime.alerts
            .map(
              (event) => `<li data-event-id="${event.id}">
                <span class="alert-text">
                  <strong>${escapeHtml(sensorLabelFromTopic(event.sensor_key))}</strong>
                  counter dropped from ${event.previous_value} to ${event.new_value}
                  · ${formatDateTime(event.detected_at)}
                </span>
                <button type="button" class="btn btn-small btn-secondary ack-reboot" data-event-id="${event.id}">
                  Acknowledge
                </button>
              </li>`,
            )
            .join('')}
        </ul>
      </div>`
    : '<div id="uptime-alert-banner" class="banner alert-banner hidden" role="alert" hidden></div>';

  const sensorRows = uptime.sensors.length
    ? uptime.sensors
        .map(
          (sensor) => `<tr>
            <td>${escapeHtml(sensorLabelFromTopic(sensor.sensor_key))}</td>
            <td><code>${escapeHtml(sensor.mqtt_topic)}</code></td>
            <td>${sensor.last_value}</td>
            <td>${formatDateTime(sensor.last_seen_at)}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4">No uptime readings yet</td></tr>';

  const rebootRows = recentReboots.length
    ? recentReboots
        .map(
          (event) => `<tr class="${event.acknowledged_at ? '' : 'warn-row'}">
            <td>${formatDateTime(event.detected_at)}</td>
            <td>${escapeHtml(sensorLabelFromTopic(event.sensor_key))}</td>
            <td>${event.previous_value} → ${event.new_value}</td>
            <td>${event.acknowledged_at ? 'Acknowledged' : '<strong class="warn">New</strong>'}</td>
          </tr>`,
        )
        .join('')
    : '<tr><td colspan="4">No reboots detected</td></tr>';

  const liveCards = live.length
    ? live
        .map(({ slot, counts }) => {
          const speakers = parseSpeakers(slot.speakers).join(', ') || '—';
          return `<article class="card">
            <header>
              <span class="room-badge">Room ${escapeHtml(slot.room_key)}</span>
              <h2>${escapeHtml(slot.title)}</h2>
              <p class="muted">${escapeHtml(speakers)} · until ${formatDateTime(slot.end_at)}</p>
            </header>
            ${voteBar({ pos: counts.pos || 0, neutral: counts.neutral || 0, neg: counts.neg || 0 })}
          </article>`;
        })
        .join('')
    : '<p class="muted">No talks are scheduled in tracked rooms right now.</p>';

  const recentRows = recent
    .map(
      (vote) => `<tr>
        <td>${formatDateTime(vote.received_at)}</td>
        <td>${escapeHtml(vote.room_key)}</td>
        <td><span class="pill ${escapeHtml(vote.vote_type === 'natural' ? 'neutral' : vote.vote_type)}">${escapeHtml(voteTypeLabel(vote.vote_type))}</span></td>
        <td>${vote.matched ? escapeHtml(vote.talk_title || vote.slot_title || '—') : '<em>Unmatched</em>'}</td>
      </tr>`,
    )
    .join('');

  const body = `
    ${alertBanner}

    <section class="toolbar">
      <div>
        <h1>Live dashboard</h1>
        <p class="muted">MQTT ${mqtt.connected ? 'connected' : 'disconnected'} · ${schedule.slotCount} schedule slots loaded</p>
      </div>
      <div class="btn-row">
        <a href="/staff/users" class="btn btn-secondary">Manage users</a>
        <a href="/staff/settings" class="btn btn-secondary">Settings</a>
        <form method="post" action="/staff/sync-schedule">
          ${req.csrfField}
          <button type="submit" class="btn btn-secondary">Sync Pretalx schedule</button>
        </form>
      </div>
    </section>

    <section class="status-grid">
      <div class="stat"><span>MQTT</span><strong class="${mqtt.connected ? 'ok' : 'warn'}">${mqtt.connected ? 'Connected' : 'Disconnected'}</strong></div>
      <div class="stat"><span>Messages</span><strong>${mqtt.messagesReceived}</strong></div>
      <div class="stat"><span>Last message</span><strong>${formatDateTime(mqtt.lastMessageAt)}</strong></div>
      <div class="stat"><span>Uptime sensors</span><strong>${uptime.sensorCount}</strong></div>
      <div class="stat"><span>Reboot alerts</span><strong class="${uptime.unacknowledgedReboots ? 'warn' : ''}">${uptime.unacknowledgedReboots}</strong></div>
      <div class="stat"><span>Schedule sync</span><strong>${formatDateTime(getMeta('last_schedule_sync'))}</strong></div>
    </section>

    <section class="panel" id="uptime-sensors-panel">
      <h2>Uptime sensors</h2>
      <p class="muted">Monitors MQTT topic <code>${escapeHtml(mqtt.uptimeTopic)}</code>. A decreasing counter indicates a device reboot.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Sensor</th><th>Topic</th><th>Counter</th><th>Last seen</th></tr></thead>
          <tbody id="uptime-sensor-rows">${sensorRows}</tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>Reboot history</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Detected</th><th>Sensor</th><th>Counter change</th><th>Status</th></tr></thead>
          <tbody id="uptime-reboot-rows">${rebootRows}</tbody>
        </table>
      </div>
    </section>

    <section class="grid two-col">
      <div>
        <h2>Active talks</h2>
        <div class="card-grid">${liveCards}</div>
      </div>
      <div>
        <h2>Recent votes</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Room</th><th>Vote</th><th>Talk</th></tr></thead>
            <tbody>${recentRows || '<tr><td colspan="4">No votes yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>

    <input type="hidden" id="live-csrf" value="${escapeHtml(getCsrfToken(req))}">
    <script src="/js/live.js"></script>`;

  res.type('html').send(
    layout({
      title: 'Live dashboard',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'live',
      csrfField: req.csrfField,
    }),
  );
});

router.post('/sync-schedule', async (req, res) => {
  try {
    await syncScheduleFromPretalx();
    res.redirect('/staff?synced=1');
  } catch (err) {
    res.status(500).type('html').send(
      layout({
        title: 'Sync failed',
        body: `<p class="error">Schedule sync failed: ${escapeHtml(err.message)}</p>
               <p><a href="/staff">Back to dashboard</a></p>`,
        staffUser: req.session.staffUser,
        csrfField: req.csrfField,
      }),
    );
  }
});

router.get('/schedule', (req, res) => {
  const slots = listScheduleSlots();
  const rows = slots
    .map((slot) => {
      const speakers = parseSpeakers(slot.speakers).join(', ') || '—';
      return `<tr>
        <td>${formatDateTime(slot.start_at)}</td>
        <td>${escapeHtml(slot.room_key)}</td>
        <td>${escapeHtml(slot.title)}</td>
        <td>${escapeHtml(speakers)}</td>
        <td>${escapeHtml(slot.submission_code)}</td>
      </tr>`;
    })
    .join('');

  const roomList = Object.entries(ROOM_MAP)
    .map(([key, info]) => `<li><strong>${key}</strong> → ${escapeHtml(info.label)} (MQTT topic: vote/${key})</li>`)
    .join('');

  const body = `
    <section class="toolbar">
      <h1>Schedule</h1>
      <form method="post" action="/staff/sync-schedule">
        ${req.csrfField}
        <button type="submit" class="btn btn-secondary">Refresh from Pretalx</button>
      </form>
    </section>
    <section class="panel">
      <h2>Room mapping</h2>
      <ul>${roomList}</ul>
    </section>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Start</th><th>Room</th><th>Title</th><th>Speakers</th><th>Code</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  res.type('html').send(
    layout({
      title: 'Schedule',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'schedule',
      csrfField: req.csrfField,
    }),
  );
});

router.get('/reports', (req, res) => {
  const report = buildStaffReportData();
  const tokens = listSpeakerReportTokens();
  const summary = getVoteSummaryBySlot();

  const summaryRows = summary
    .filter((row) => row.total_votes > 0)
    .map((row) => {
      const speakers = parseSpeakers(row.speakers).join(', ') || '—';
      const rate = positiveRate({ pos: row.pos, neg: row.neg, neutral: row.neutral });
      return `<tr>
        <td>${formatDateTime(row.start_at)}</td>
        <td>${escapeHtml(row.room_name)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${escapeHtml(speakers)}</td>
        <td>${row.pos || 0}</td>
        <td>${row.neutral || 0}</td>
        <td>${row.neg || 0}</td>
        <td>${rate === null ? '—' : `${rate}%`}</td>
        <td>
          <form method="post" action="/staff/reports/speaker-link" class="inline-form">
            ${req.csrfField}
            <input type="hidden" name="slot_id" value="${row.slot_id}">
            <input type="hidden" name="submission_code" value="${escapeHtml(row.submission_code)}">
            <button type="submit" class="btn btn-small">Create speaker link</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  const tokenRows = tokens
    .map(
      (token) => `<tr>
        <td>${escapeHtml(token.title)}</td>
        <td>${formatDateTime(token.start_at)}</td>
        <td><code>/report/${escapeHtml(token.token)}</code></td>
        <td>
          <form method="post" action="/staff/reports/revoke" class="inline-form">
            ${req.csrfField}
            <input type="hidden" name="token" value="${escapeHtml(token.token)}">
            <button type="submit" class="btn btn-small btn-danger">Revoke</button>
          </form>
        </td>
      </tr>`,
    )
    .join('');

  const body = `
    <section class="toolbar">
      <div>
        <h1>Reports</h1>
        <p class="muted">Generated ${formatDateTime(report.generatedAt)} · Last schedule sync ${formatDateTime(report.lastScheduleSync)}</p>
      </div>
      <div class="btn-row">
        <a class="btn btn-secondary" href="/staff/reports/staff.html">Staff HTML report</a>
        <a class="btn btn-secondary" href="/staff/reports/staff.csv">Download CSV</a>
      </div>
    </section>

    <section class="status-grid">
      <div class="stat"><span>Total votes</span><strong>${report.totals.total}</strong></div>
      <div class="stat"><span>Positive</span><strong class="pos">${report.totals.pos}</strong></div>
      <div class="stat"><span>Neutral</span><strong>${report.totals.neutral}</strong></div>
      <div class="stat"><span>Negative</span><strong class="neg">${report.totals.neg}</strong></div>
      <div class="stat"><span>Unmatched</span><strong class="warn">${report.unmatchedCount}</strong></div>
    </section>

    <section class="panel">
      <h2>Talks with feedback</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Start</th><th>Room</th><th>Title</th><th>Speakers</th><th>+</th><th>○</th><th>−</th><th>Pos %</th><th>Speaker link</th></tr>
          </thead>
          <tbody>${summaryRows || '<tr><td colspan="9">No votes recorded yet</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>Active speaker report links</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Talk</th><th>Start</th><th>URL path</th><th></th></tr></thead>
          <tbody>${tokenRows || '<tr><td colspan="4">No active links</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;

  res.type('html').send(
    layout({
      title: 'Reports',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'reports',
      csrfField: req.csrfField,
    }),
  );
});

router.post('/reports/speaker-link', express.urlencoded({ extended: false }), (req, res) => {
  const slotId = Number(req.body.slot_id);
  const submissionCode = req.body.submission_code;
  const slot = getSlotById(slotId);
  if (!slot || slot.submission_code !== submissionCode) {
    res.redirect('/staff/reports?error=invalid-slot');
    return;
  }
  const token = createSpeakerReportToken({
    slotId,
    submissionCode,
    createdBy: req.session.staffUser.username,
  });
  res.redirect(`/report/${token}`);
});

router.post('/reports/revoke', express.urlencoded({ extended: false }), (req, res) => {
  revokeSpeakerReportToken(req.body.token);
  res.redirect('/staff/reports');
});

router.get('/reports/staff.csv', (req, res) => {
  const report = buildStaffReportData();
  res
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="self-talk-feedback-report.csv"')
    .send(summaryToCsv(report.summary));
});

router.get('/reports/staff.html', (req, res) => {
  const report = buildStaffReportData();
  const rows = report.summary
    .map((row) => {
      const speakers = parseSpeakers(row.speakers).join(', ') || '—';
      return `<tr>
        <td>${formatDateTime(row.start_at)}</td>
        <td>${escapeHtml(row.room_name)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${escapeHtml(speakers)}</td>
        <td>${row.pos || 0}</td>
        <td>${row.neutral || 0}</td>
        <td>${row.neg || 0}</td>
        <td>${row.total_votes || 0}</td>
      </tr>`;
    })
    .join('');

  const unmatchedRows = report.unmatched
    .map(
      (vote) => `<tr>
        <td>${formatDateTime(vote.received_at)}</td>
        <td>${escapeHtml(vote.room_key)}</td>
        <td>${escapeHtml(voteTypeLabel(vote.vote_type))}</td>
        <td>${escapeHtml(vote.raw_payload)}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <section class="toolbar">
      <h1>Staff event report</h1>
      <p class="muted">SouthEast Linux Fest 2026 · Generated ${formatDateTime(report.generatedAt)}</p>
    </section>
    <section class="status-grid">
      <div class="stat"><span>Total votes</span><strong>${report.totals.total}</strong></div>
      <div class="stat"><span>Positive</span><strong>${report.totals.pos}</strong></div>
      <div class="stat"><span>Neutral</span><strong>${report.totals.neutral}</strong></div>
      <div class="stat"><span>Negative</span><strong>${report.totals.neg}</strong></div>
    </section>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Start</th><th>Room</th><th>Title</th><th>Speakers</th><th>+</th><th>○</th><th>−</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <section class="panel">
      <h2>Unmatched votes (${report.unmatchedCount})</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Room</th><th>Type</th><th>Raw payload</th></tr></thead>
          <tbody>${unmatchedRows || '<tr><td colspan="4">None</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <p><a href="/staff/reports">Back to reports</a></p>`;

  res.type('html').send(
    layout({
      title: 'Staff event report',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'reports',
      csrfField: req.csrfField,
    }),
  );
});

router.post('/uptime/acknowledge', express.urlencoded({ extended: false }), (req, res) => {
  const eventId = Number(req.body.eventId);
  if (!eventId) {
    res.status(400).json({ ok: false, error: 'invalid_event' });
    return;
  }
  const ok = acknowledgeRebootEvent(eventId);
  res.json({ ok });
});

router.get('/api/live', (req, res) => {
  res.json({
    mqtt: getMqttStatus(),
    live: getLiveRoomStats(),
    recent: getRecentVotes(20),
    schedule: getScheduleStats(),
    lastScheduleSync: getMeta('last_schedule_sync'),
    uptime: getUptimeSummary(),
    recentReboots: listRecentReboots(10),
    csrfToken: getCsrfToken(req),
  });
});

export default router;
