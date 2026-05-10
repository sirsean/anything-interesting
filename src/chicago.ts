const DIGEST_HOURS = new Set(['5', '15', '18']);

/** America/Chicago local hour, 24h string without padding (matches INITIAL.md gate). */
export function getChicagoHour(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).format(date);
}

export function isDigestHour(date: Date = new Date()): boolean {
  return DIGEST_HOURS.has(getChicagoHour(date));
}
