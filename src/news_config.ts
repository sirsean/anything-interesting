import type { Env } from './env';

export const NEWS_TOPICS = ['world', 'politics', 'economics', 'science', 'space', 'nature', 'health', 'technology', 'culture', 'sports', 'local', 'general'] as const;
export type NewsTopic = typeof NEWS_TOPICS[number];
export const LEGACY_TOPICS = ['geopolitics'] as const;
export function isNewsTopic(value: string): boolean {
  return [...NEWS_TOPICS, ...LEGACY_TOPICS].includes(value as NewsTopic);
}
export function configInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return value?.trim() && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
export function digestTimezone(env: Env): string {
  const zone = env.DIGEST_TIMEZONE?.trim() || 'America/Chicago';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone; }
  catch { return 'America/Chicago'; }
}
export function localEditionDay(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function editionDue(env: Env, now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: digestTimezone(env), hour: 'numeric', hourCycle: 'h23' }).format(now));
  // Retry a prepared edition later that evening after a transient pipeline/delivery failure.
  return hour >= configInt(env.DIGEST_HOUR, 17, 0, 23);
}
export function familyProfile(env: Env): string {
  return [
    'Parent-facing general-interest briefing for family conversation. Explain clearly without assuming children\'s ages.',
    env.FAMILY_INTERESTS?.trim() ? `Optional interests: ${env.FAMILY_INTERESTS.slice(0, 800)}` : '',
    env.LOCAL_NEWS_REGION?.trim() ? `Local region: ${env.LOCAL_NEWS_REGION.slice(0, 150)}` : '',
  ].filter(Boolean).join('\n');
}
