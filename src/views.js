import { config } from './config.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDateTime(isoString) {
  if (!isoString) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.displayTimezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoString));
}

export function parseSpeakers(json) {
  try {
    const speakers = JSON.parse(json || '[]');
    return Array.isArray(speakers) ? speakers : [];
  } catch {
    return [];
  }
}

export function layout({ title, body, staffUser, activeNav, csrfField = '' }) {
  const navItems = staffUser
    ? [
        { href: '/staff', label: 'Live', key: 'live' },
        { href: '/staff/reports', label: 'Reports', key: 'reports' },
        { href: '/staff/schedule', label: 'Schedule', key: 'schedule' },
        { href: '/staff/users', label: 'Users', key: 'users' },
        { href: '/staff/settings', label: 'Settings', key: 'settings' },
      ]
    : [];

  const nav = navItems
    .map(
      (item) =>
        `<a href="${item.href}" class="${activeNav === item.key ? 'active' : ''}">${escapeHtml(item.label)}</a>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · SELF Talk Feedback</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <strong>SELF Talk Feedback</strong>
      <span class="tagline">Audience vote capture</span>
    </div>
    <nav>${nav}</nav>
    <div class="header-actions">
      ${
        staffUser
          ? `<span class="user">${escapeHtml(staffUser.username)}</span>
             <form method="post" action="/logout" class="inline-form">
               ${csrfField}
               <button type="submit" class="btn btn-secondary">Log out</button>
             </form>`
          : ''
      }
    </div>
  </header>
  <main class="container">${body}</main>
</body>
</html>`;
}

export function voteBar({ pos = 0, natural = 0, neg = 0 }) {
  const total = pos + natural + neg;
  if (!total) {
    return '<div class="vote-bar empty"><span>No votes yet</span></div>';
  }

  const pct = (n) => Math.round((n / total) * 100);
  return `<div class="vote-bar" aria-label="Vote breakdown">
    <span class="segment pos" style="width:${pct(pos)}%" title="Positive: ${pos}"></span>
    <span class="segment natural" style="width:${pct(natural)}%" title="Neutral: ${natural}"></span>
    <span class="segment neg" style="width:${pct(neg)}%" title="Negative: ${neg}"></span>
  </div>
  <div class="vote-legend">
    <span class="pos">Positive ${pos}</span>
    <span class="natural">Neutral ${natural}</span>
    <span class="neg">Negative ${neg}</span>
    <span class="total">Total ${total}</span>
  </div>`;
}
