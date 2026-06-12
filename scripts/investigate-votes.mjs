import Database from 'better-sqlite3';

const db = new Database('/opt/self-talk-feedback/data/feedback.db', { readonly: true });
const tz = 'America/New_York';
const targetDate = process.argv[2] || '06/12/2026';

function fmt(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
}

function localParts(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.month}/${parts.day}/${parts.year}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function findActiveSlot(roomKey, atIso) {
  return db
    .prepare(
      `SELECT id, title, start_at, end_at FROM schedule_slots
       WHERE room_key = ? AND start_at <= ? AND end_at > ?
       ORDER BY start_at DESC LIMIT 1`,
    )
    .get(roomKey, atIso, atIso);
}

function slotActiveAt(slot, atMs) {
  return Date.parse(slot.start_at) <= atMs && Date.parse(slot.end_at) > atMs;
}

const votes = db.prepare('SELECT * FROM votes ORDER BY received_at ASC').all();
const filtered = votes.filter((v) => {
  const p = localParts(v.received_at);
  return p.date === targetDate && p.hour === 10 && p.minute >= 48 && p.minute <= 55;
});

console.log(`=== Votes on ${targetDate} 10:48–10:55 ${tz} (${filtered.length}) ===\n`);
for (const v of filtered) {
  const active = findActiveSlot(v.room_key, v.received_at);
  const mismatch = Boolean(active) !== Boolean(v.matched)
    || (active && v.slot_id && active.id !== v.slot_id);
  console.log({
    local: fmt(v.received_at),
    utc: v.received_at,
    room: v.room_key,
    type: v.vote_type,
    stored_matched: v.matched ? 'yes' : 'NO',
    stored_talk: v.talk_title,
    replay_match: active?.title || 'NONE',
    logic_ok: mismatch ? 'MISMATCH' : 'ok',
  });
}

console.log('\n=== Schedule slots starting 10:xx on that date ===\n');
const slots = db.prepare('SELECT * FROM schedule_slots ORDER BY room_key, start_at').all();
for (const room of ['A', 'B', 'C', 'D']) {
  console.log(`Room ${room}:`);
  for (const s of slots.filter((x) => x.room_key === room)) {
    const start = localParts(s.start_at);
    if (start.date !== targetDate) continue;
    if (start.hour < 9 || start.hour > 11) continue;
    console.log(`  [${s.id}] ${s.title}`);
    console.log(`      ${fmt(s.start_at)} – ${fmt(s.end_at)}`);
  }
}

console.log('\n=== Gaps: unmatched votes with diagnosis ===\n');
const unmatched = db.prepare('SELECT * FROM votes WHERE matched = 0 ORDER BY received_at ASC').all();
for (const v of unmatched) {
  const p = localParts(v.received_at);
  const active = findActiveSlot(v.room_key, v.received_at);
  const nearest = db
    .prepare(
      `SELECT id, title, start_at, end_at FROM schedule_slots
       WHERE room_key = ?
       ORDER BY ABS(strftime('%s', start_at) - strftime('%s', ?)) ASC LIMIT 3`,
    )
    .all(v.room_key, v.received_at);
  console.log(`${fmt(v.received_at)} (${p.date} ${p.hour}:${String(p.minute).padStart(2, '0')}) room ${v.room_key} ${v.vote_type}`);
  console.log(`  would match now: ${active?.title || 'NONE'}`);
  for (const s of nearest) {
    const gap = Date.parse(v.received_at) - Date.parse(s.end_at);
    const before = Date.parse(s.start_at) - Date.parse(v.received_at);
    let note = 'during slot';
    if (!slotActiveAt(s, Date.parse(v.received_at))) {
      if (Date.parse(v.received_at) < Date.parse(s.start_at)) note = `before start by ${Math.round(before / 60000)} min`;
      else note = `after end by ${Math.round(gap / 60000)} min`;
    }
    console.log(`  - ${s.title}: ${fmt(s.start_at)} – ${fmt(s.end_at)} (${note})`);
  }
  console.log('');
}

console.log(`Total votes: ${votes.length}, unmatched: ${unmatched.length}`);
