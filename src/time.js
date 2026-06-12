/** Normalize any ISO8601 timestamp to UTC for consistent SQLite comparisons. */
export function toUtcIso(value) {
  return new Date(value).toISOString();
}

export function isWithinSlot(receivedAtIso, startAt, endAt, graceMinutes = 0) {
  const t = Date.parse(receivedAtIso);
  const graceMs = graceMinutes * 60_000;
  return t >= Date.parse(startAt) - graceMs && t < Date.parse(endAt) + graceMs;
}
