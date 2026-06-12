import express from 'express';
import { buildSpeakerReportData, getTokenRecord, positiveRate } from '../reports.js';
import { escapeHtml, formatDateTime, layout, parseSpeakers, voteBar } from '../views.js';

const router = express.Router();

router.get('/:token', (req, res) => {
  const tokenRecord = getTokenRecord(req.params.token);
  if (!tokenRecord) {
    res.status(404).type('html').send(
      layout({
        title: 'Report not found',
        body: '<section class="panel narrow"><h1>Report not found</h1><p class="muted">This link may have expired or been revoked.</p></section>',
      }),
    );
    return;
  }

  const report = buildSpeakerReportData(tokenRecord.slot_id);
  if (!report) {
    res.status(404).type('html').send(
      layout({
        title: 'Report not found',
        body: '<section class="panel narrow"><h1>Talk not found</h1></section>',
      }),
    );
    return;
  }

  const { slot, totals, hourly } = report;
  const speakers = parseSpeakers(slot.speakers).join(', ') || 'Speaker';
  const pos = totals.pos || 0;
  const neutral = totals.neutral || 0;
  const neg = totals.neg || 0;
  const rate = positiveRate({ pos, neutral, neg });

  const hourlyRows = hourly
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.hour)}</td>
        <td>${row.pos || 0}</td>
        <td>${row.neutral || 0}</td>
        <td>${row.neg || 0}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <section class="panel speaker-report">
      <p class="eyebrow">Audience feedback · SouthEast Linux Fest 2026</p>
      <h1>${escapeHtml(slot.title)}</h1>
      <p class="lead">${escapeHtml(speakers)}</p>
      <p class="muted">${escapeHtml(slot.room_name)} · ${formatDateTime(slot.start_at)} – ${formatDateTime(slot.end_at)}</p>

      ${voteBar({ pos, neutral, neg })}

      <div class="metric-row">
        <div class="metric"><span>Total responses</span><strong>${totals.total || 0}</strong></div>
        <div class="metric"><span>Positive share</span><strong>${rate === null ? '—' : `${rate}%`}</strong></div>
      </div>

      ${
        hourly.length
          ? `<section>
              <h2>Votes over time</h2>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Hour</th><th>Positive</th><th>Neutral</th><th>Negative</th></tr></thead>
                  <tbody>${hourlyRows}</tbody>
                </table>
              </div>
            </section>`
          : ''
      }

      <p class="muted footnote">Thank you for speaking at SELF. This report reflects anonymous audience button presses during your session.</p>
    </section>`;

  res.type('html').send(layout({ title: slot.title, body }));
});

export default router;
