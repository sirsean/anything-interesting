import type { Env } from './env';

/** ~3 digests × few judgments + buffer; aligns with INITIAL ~10–20/day target. */
export const KIMI_JUDGMENT_DAILY_CAP = 22;

export function kimiJudgmentDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export const KIMI_COUNT_KEY_PREFIX = 'llm:kimi_count:';

function kimiCountKey(day: string): string {
  return `${KIMI_COUNT_KEY_PREFIX}${day}`;
}

export type KimiJudgmentUsage = {
  day: string;
  used: number;
  cap: number;
  remaining: number;
};

function parseKimiCount(raw: string | null): number {
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function usageForDay(day: string, used: number): KimiJudgmentUsage {
  return {
    day,
    used,
    cap: KIMI_JUDGMENT_DAILY_CAP,
    remaining: Math.max(0, KIMI_JUDGMENT_DAILY_CAP - used),
  };
}

/** Validates `YYYY-MM-DD` as a real UTC calendar day. */
export function isKimiJudgmentDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(t) && kimiJudgmentDayKey(new Date(t)) === day;
}

export async function getKimiJudgmentUsageForDay(
  env: Env,
  day: string,
): Promise<KimiJudgmentUsage> {
  const raw = await env.CONFIG.get(kimiCountKey(day));
  return usageForDay(day, parseKimiCount(raw));
}

export async function getKimiJudgmentUsage(
  env: Env,
  now = new Date(),
): Promise<KimiJudgmentUsage> {
  return getKimiJudgmentUsageForDay(env, kimiJudgmentDayKey(now));
}

/** All days still present in CONFIG KV (newest first). */
export async function listKimiJudgmentUsage(env: Env): Promise<KimiJudgmentUsage[]> {
  const listed = await env.CONFIG.list({ prefix: KIMI_COUNT_KEY_PREFIX });
  const items: KimiJudgmentUsage[] = [];
  for (const key of listed.keys) {
    const day = key.name.slice(KIMI_COUNT_KEY_PREFIX.length);
    if (!isKimiJudgmentDay(day)) continue;
    const raw = await env.CONFIG.get(key.name);
    items.push(usageForDay(day, parseKimiCount(raw)));
  }
  items.sort((a, b) => b.day.localeCompare(a.day));
  return items;
}

export async function recordKimiJudgmentCall(env: Env): Promise<void> {
  const day = kimiJudgmentDayKey();
  const key = kimiCountKey(day);
  const raw = await env.CONFIG.get(key);
  const n = (raw ? parseInt(raw, 10) : 0) || 0;
  await env.CONFIG.put(key, String(n + 1), { expirationTtl: 86400 * 2 });
}
