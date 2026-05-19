import type { Env } from './env';

/** ~3 digests × few judgments + buffer; aligns with INITIAL ~10–20/day target. */
export const KIMI_JUDGMENT_DAILY_CAP = 22;

export function kimiJudgmentDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function kimiCountKey(day: string): string {
  return `llm:kimi_count:${day}`;
}

export type KimiJudgmentUsage = {
  day: string;
  used: number;
  cap: number;
  remaining: number;
};

export async function getKimiJudgmentUsage(
  env: Env,
  now = new Date(),
): Promise<KimiJudgmentUsage> {
  const day = kimiJudgmentDayKey(now);
  const raw = await env.CONFIG.get(kimiCountKey(day));
  const parsed = raw ? parseInt(raw, 10) : 0;
  const used = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return {
    day,
    used,
    cap: KIMI_JUDGMENT_DAILY_CAP,
    remaining: Math.max(0, KIMI_JUDGMENT_DAILY_CAP - used),
  };
}

export async function recordKimiJudgmentCall(env: Env): Promise<void> {
  const day = kimiJudgmentDayKey();
  const key = kimiCountKey(day);
  const raw = await env.CONFIG.get(key);
  const n = (raw ? parseInt(raw, 10) : 0) || 0;
  await env.CONFIG.put(key, String(n + 1), { expirationTtl: 86400 * 2 });
}
