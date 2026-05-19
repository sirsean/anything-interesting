import { describe, expect, it } from 'vitest';
import {
  KIMI_JUDGMENT_DAILY_CAP,
  getKimiJudgmentUsage,
  kimiJudgmentDayKey,
} from '../src/kimi_budget';
import type { Env } from '../src/env';

function makeKv(count: number | null): KVNamespace {
  return {
    get: async () => (count != null ? String(count) : null),
    put: async () => {},
  } as unknown as KVNamespace;
}

describe('kimiJudgmentDayKey', () => {
  it('uses UTC calendar day', () => {
    expect(kimiJudgmentDayKey(new Date('2026-05-18T23:30:00Z'))).toBe('2026-05-18');
    expect(kimiJudgmentDayKey(new Date('2026-05-19T00:30:00Z'))).toBe('2026-05-19');
  });
});

describe('getKimiJudgmentUsage', () => {
  it('treats missing KV as zero used', async () => {
    const env = { CONFIG: makeKv(null) } as Env;
    const usage = await getKimiJudgmentUsage(env, new Date('2026-05-18T12:00:00Z'));
    expect(usage).toEqual({
      day: '2026-05-18',
      used: 0,
      cap: KIMI_JUDGMENT_DAILY_CAP,
      remaining: KIMI_JUDGMENT_DAILY_CAP,
    });
  });

  it('computes remaining from stored count', async () => {
    const env = { CONFIG: makeKv(11) } as Env;
    const usage = await getKimiJudgmentUsage(env, new Date('2026-05-18T12:00:00Z'));
    expect(usage.used).toBe(11);
    expect(usage.remaining).toBe(11);
  });
});
