import express from 'express';
import { requireStaff } from '../auth.js';
import { getMeta } from '../db.js';
import { getMqttStatus } from '../mqttClient.js';
import { syncScheduleFromPretalx, getScheduleStats, listScheduleSlots } from '../pretalx.js';
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
import { escapeHtml, formatDateTime, layout, parseSpeakers, voteBar } from '../views.js';
import { ROOM_MAP } from '../config.js';
import userRoutes from './userRoutes.js';
import mqttRoutes from './mqttRoutes.js';
import pretalxRoutes from './pretalxRoutes.js';

const router = express.Router();
router.use(requireStaff);
router.use('/users', userRoutes);
router.use('/mqtt', mqttRoutes);
router.use('/pretalx', pretalxRoutes);

router.get('/', (req, res) => {
  const live = getLiveRoomStats();
  const recent = getRecentVotes(20);
  const mqtt = getMqttStatus();
  const schedule = getScheduleStats();

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
            ${voteBar({ pos: counts.pos || 0, natural: counts.natural || 0, neg: counts.neg || 0 })}
          </article>`;
        })
        .join('')
    : '<p class="muted">No talks are scheduled in tracked rooms right now.</p>';

  const recentRows = recent
    .map(
      (vote) => `<tr>
        <td>${formatDateTime(vote.received_at)}</td>
        <td>${escapeHtml(vote.room_key)}</td>
        <td><span class="pill ${escapeHtml(vote.vote_type)}">${escapeHtml(vote.vote_type)}</span></td>
        <td>${vote.matched ? escapeHtml(vote.talk_title || vote.slot_title || '—') : '<em>Unmatched</em>'}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <section class="toolbar">
      <div>
        <h1>Live dashboard</h1>
        <p class="muted">MQTT ${mqtt.connected ? 'connected' : 'disconnected'} · ${schedule.slotCount} schedule slots loaded</p>
      </div>
      <div class="btn-row">
        <a href="/staff/users" class="btn btn-secondary">Manage users</a>
        <a href="/staff/mqtt" class="btn btn-secondary">MQTT settings</a>
        <a href="/staff/pretalx" class="btn btn-secondary">Pretalx settings</a>
        <form method="post" action="/staff/sync-schedule">
          <button type="submit" class="btn btn-secondary">Sync Pretalx schedule</button>
        </form>
      </div>
    </section>

    <section class="status-grid">
      <div class="stat"><span>MQTT</span><strong class="${mqtt.connected ? 'ok' : 'warn'}">${mqtt.connected ? 'Connected' : 'Disconnected'}</strong></div>
      <div class="stat"><span>Messages</span><strong>${mqtt.messagesReceived}</strong></div>
      <div class="stat"><span>Last vote</span><strong>${formatDateTime(mqtt.lastMessageAt)}</strong></div>
      <div class="stat"><span>Schedule sync</span><strong>${formatDateTime(getMeta('last_schedule_sync'))}</strong></div>
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

    <script src="/js/live.js"></script>`;

  res.type('html').send(
    layout({ title: 'Live dashboard', body, staffUser: req.session.staffUser, activeNav: 'live' }),
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
    layout({ title: 'Schedule', body, staffUser: req.session.staffUser, activeNav: 'schedule' }),
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
      const rate = positiveRate({ pos: row.pos, neg: row.neg, natural: row.natural });
      return `<tr>
        <td>${formatDateTime(row.start_at)}</td>
        <td>${escapeHtml(row.room_name)}</td>
        <td>${escapeHtml(row.title)}</td>
        <td>${escapeHtml(speakers)}</td>
        <td>${row.pos || 0}</td>
        <td>${row.natural || 0}</td>
        <td>${row.neg || 0}</td>
        <td>${rate === null ? '—' : `${rate}%`}</td>
        <td>
          <form method="post" action="/staff/reports/speaker-link" class="inline-form">
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
      <div class="stat"><span>Neutral</span><strong>${report.totals.natural}</strong></div>
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
    layout({ title: 'Reports', body, staffUser: req.session.staffUser, activeNav: 'reports' }),
  );
});

router.post('/reports/speaker-link', express.urlencoded({ extended: false }), (req, res) => {
  const slotId = Number(req.body.slot_id);
  const submissionCode = req.body.submission_code;
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
        <td>${row.natural || 0}</td>
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
        <td>${escapeHtml(vote.vote_type)}</td>
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
      <div class="stat"><span>Neutral</span><strong>${report.totals.natural}</strong></div>
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
    layout({ title: 'Staff event report', body, staffUser: req.session.staffUser, activeNav: 'reports' }),
  );
});

router.get('/api/live', (req, res) => {
  res.json({
    mqtt: getMqttStatus(),
    live: getLiveRoomStats(),
    recent: getRecentVotes(20),
    schedule: getScheduleStats(),
    lastScheduleSync: getMeta('last_schedule_sync'),
  });
});

export default router;
