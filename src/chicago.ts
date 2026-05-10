const DIGEST_HOUR_NUMS = new Set([5, 15, 18]);

/**
 * America/Chicago local hour as formatted by Intl (ICU uses two-digit hours, e.g. "05").
 * INITIAL.md shows ['5','15','18']; we gate on numeric hour so padding never breaks the 05:00 slot.
 */
export function getChicagoHour(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).format(date);
}

export function isDigestHour(date: Date = new Date()): boolean {
  const n = parseInt(getChicagoHour(date), 10);
  return Number.isFinite(n) && DIGEST_HOUR_NUMS.has(n);
}
