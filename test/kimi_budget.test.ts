import { describe, expect, it } from 'vitest';
import {
  KIMI_JUDGMENT_DAILY_CAP,
  getKimiJudgmentUsage,
  getKimiJudgmentUsageForDay,
  isKimiJudgmentDay,
  kimiJudgmentDayKey,
  listKimiJudgmentUsage,
} from '../src/kimi_budget';
import type { Env } from '../src/env';

function makeKv(counts: Record<string, number> | number | null): KVNamespace {
  const byDay: Record<string, number> =
    typeof counts === 'number'
      ? { '2026-05-18': counts }
      : counts === null
        ? {}
        : counts;

  return {
    get: async (key: string) => {
      const day = key.replace('llm:kimi_count:', '');
      const n = byDay[day];
      return n != null ? String(n) : null;
    },
    list: async () => ({
      keys: Object.keys(byDay).map((day) => ({
        name: `llm:kimi_count:${day}`,
        expiration: null,
        metadata: null,
      })),
      list_complete: true,
      cursor: '',
    }),
    put: async () => {},
  } as unknown as KVNamespace;
}

describe('kimiJudgmentDayKey', () => {
  it('uses UTC calendar day', () => {
    expect(kimiJudgmentDayKey(new Date('2026-05-18T23:30:00Z'))).toBe('2026-05-18');
    expect(kimiJudgmentDayKey(new Date('2026-05-19T00:30:00Z'))).toBe('2026-05-19');
  });
});

describe('isKimiJudgmentDay', () => {
  it('accepts valid UTC days and rejects garbage', () => {
    expect(isKimiJudgmentDay('2026-05-18')).toBe(true);
    expect(isKimiJudgmentDay('2026-05-32')).toBe(false);
    expect(isKimiJudgmentDay('05-18-2026')).toBe(false);
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

describe('getKimiJudgmentUsageForDay', () => {
  it('reads an arbitrary day key', async () => {
    const env = { CONFIG: makeKv({ '2026-05-17': 3 }) } as Env;
    const usage = await getKimiJudgmentUsageForDay(env, '2026-05-17');
    expect(usage.used).toBe(3);
    expect(usage.remaining).toBe(19);
  });
});

describe('listKimiJudgmentUsage', () => {
  it('returns all prefixed keys newest-first', async () => {
    const env = {
      CONFIG: makeKv({ '2026-05-17': 3, '2026-05-18': 11 }),
    } as Env;
    const items = await listKimiJudgmentUsage(env);
    expect(items.map((i) => i.day)).toEqual(['2026-05-18', '2026-05-17']);
    expect(items[0].used).toBe(11);
  });
});
