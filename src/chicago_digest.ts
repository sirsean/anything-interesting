import { getChicagoHour } from './chicago';

/** Next scheduled digest slot label (05:00 / 15:00 / 18:00 CT), based on current Chicago hour. */
export function nextScheduledDigestLabel(now: Date = new Date()): string {
  const h = parseInt(getChicagoHour(now), 10);
  let slot = 5;
  if (h < 5) slot = 5;
  else if (h < 15) slot = 15;
  else if (h < 18) slot = 18;
  else slot = 5;
  return `${String(slot).padStart(2, '0')}:00 CT`;
}

/** Format an ISO timestamp in America/Chicago as `HH:00 CT` (hour bucket for copy). */
export function formatChicagoDigestSlotFromIso(iso: string): string {
  const d = new Date(iso);
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).format(d);
  const padded = hour.padStart(2, '0');
  return `${padded}:00 CT`;
}
