/** Normalize any ISO8601 timestamp to UTC for consistent SQLite comparisons. */
export function toUtcIso(value) {
  return new Date(value).toISOString();
}

export function isWithinSlot(receivedAtIso, startAt, endAt) {
  const t = Date.parse(receivedAtIso);
  return t >= Date.parse(startAt) && t < Date.parse(endAt);
}
