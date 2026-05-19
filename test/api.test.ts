import { describe, expect, it } from 'vitest';
import { handleApiRequest, parseLlmReasoning } from '../src/api';
import type { Env } from '../src/env';
import { kimiJudgmentDayKey } from '../src/kimi_budget';

type StatsRow = {
  articles_last_24h: number;
  distinct_sources_last_24h: number;
  clusters_above_threshold: number;
  polymarket_matched_count: number;
};

function makeEnv(opts: {
  statsRow?: StatsRow | null;
  clusterRow?: Record<string, unknown> | null;
  lastDigest?: string | null;
  kimiJudgmentUsed?: number;
  kimiJudgmentByDay?: Record<string, number>;
} = {}): Env {
  const statsRow = opts.statsRow ?? {
    articles_last_24h: 7,
    distinct_sources_last_24h: 3,
    clusters_above_threshold: 2,
    polymarket_matched_count: 1,
  };

  const fakeDb = {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('articles_last_24h')) return statsRow;
          if (sql.includes('FROM clusters c')) return opts.clusterRow ?? null;
          return null;
        },
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;

  const kimiByDay: Record<string, number> =
    opts.kimiJudgmentByDay ??
    (opts.kimiJudgmentUsed != null
      ? { [kimiJudgmentDayKey()]: opts.kimiJudgmentUsed }
      : {});

  const fakeKv = {
    get: async (key: string) => {
      if (key.startsWith('llm:kimi_count:')) {
        const day = key.slice('llm:kimi_count:'.length);
        const n = kimiByDay[day];
        return n != null ? String(n) : null;
      }
      if (key === 'cursors:last_digest_at') return opts.lastDigest ?? null;
      return null;
    },
    list: async ({ prefix }: { prefix?: string }) => {
      if (prefix !== 'llm:kimi_count:') return { keys: [], list_complete: true, cursor: '' };
      return {
        keys: Object.keys(kimiByDay).map((day) => ({
          name: `llm:kimi_count:${day}`,
          expiration: null,
          metadata: null,
        })),
        list_complete: true,
        cursor: '',
      };
    },
  } as unknown as KVNamespace;

  return {
    DB: fakeDb,
    CONFIG: fakeKv,
    HEADLINES: {} as Vectorize,
    MARKETS: {} as Vectorize,
    AI: {} as Ai,
  };
}

describe('parseLlmReasoning', () => {
  it('returns null for empty / null input', () => {
    expect(parseLlmReasoning(null)).toBeNull();
    expect(parseLlmReasoning('')).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    expect(parseLlmReasoning('{not json')).toBeNull();
  });

  it('parses score / reason / at fields', () => {
    expect(
      parseLlmReasoning(JSON.stringify({ score: 0.71, reason: 'because', at: '2026-05-10T00:00:00Z' })),
    ).toEqual({ score: 0.71, reason: 'because', at: '2026-05-10T00:00:00Z' });
  });

  it('tolerates missing fields', () => {
    expect(parseLlmReasoning(JSON.stringify({ reason: 'only' }))).toEqual({
      score: null,
      reason: 'only',
      at: null,
    });
  });
});

describe('handleApiRequest routing', () => {
  it('returns null for non-GET methods so the caller falls through', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats', { method: 'POST' }),
      makeEnv(),
    );
    expect(res).toBeNull();
  });

  it('returns null for non-/api paths', async () => {
    const res = await handleApiRequest(new Request('https://example.test/health'), makeEnv());
    expect(res).toBeNull();
  });

  it('404s unknown /api routes', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/does-not-exist'),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it('400s when cluster id is non-numeric (no route match)', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/clusters/abc'),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it('returns stats JSON with cache-control + content-type headers', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats'),
      makeEnv({ lastDigest: '2026-05-09T20:00:00Z' }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get('content-type')).toContain('application/json');
    expect(res!.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body.articles_last_24h).toBe(7);
    expect(body.distinct_sources_last_24h).toBe(3);
    expect(body.clusters_above_threshold).toBe(2);
    expect(body.polymarket_matched_count).toBe(1);
    expect(body.last_digest_at).toBe('2026-05-09T20:00:00Z');
    expect(typeof body.generated_at).toBe('string');
    const kimi = body.kimi as { judgment: Record<string, unknown> };
    expect(kimi.judgment.used).toBe(0);
    expect(kimi.judgment.cap).toBe(22);
    expect(kimi.judgment.remaining).toBe(22);
    expect(typeof kimi.judgment.day).toBe('string');
  });

  it('returns kimi judgment usage from CONFIG KV', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats'),
      makeEnv({ kimiJudgmentUsed: 11 }),
    );
    const body = (await res!.json()) as { kimi: { judgment: Record<string, number> } };
    expect(body.kimi.judgment.used).toBe(11);
    expect(body.kimi.judgment.cap).toBe(22);
    expect(body.kimi.judgment.remaining).toBe(11);
  });

  it('GET /api/stats/kimi?day= returns a single day', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats/kimi?day=2026-05-17'),
      makeEnv({ kimiJudgmentByDay: { '2026-05-17': 3 } }),
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { kimi: { judgment: Record<string, number> } };
    expect(body.kimi.judgment.day).toBe('2026-05-17');
    expect(body.kimi.judgment.used).toBe(3);
    expect(body.kimi.judgment.remaining).toBe(19);
  });

  it('GET /api/stats/kimi rejects invalid day', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats/kimi?day=not-a-day'),
      makeEnv(),
    );
    expect(res!.status).toBe(400);
  });

  it('GET /api/stats/kimi lists KV history newest-first', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/stats/kimi'),
      makeEnv({ kimiJudgmentByDay: { '2026-05-17': 3, '2026-05-18': 11 } }),
    );
    const body = (await res!.json()) as {
      kimi: { judgment: { cap: number; items: Array<{ day: string; used: number }> } };
    };
    expect(body.kimi.judgment.cap).toBe(22);
    expect(body.kimi.judgment.items.map((i) => i.day)).toEqual(['2026-05-18', '2026-05-17']);
    expect(body.kimi.judgment.items[0].used).toBe(11);
  });

  it('returns empty topnews list when D1 has no clusters', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/topnews?count=5&topic=geopolitics&window=12'),
      makeEnv(),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      items: unknown[];
      meta: { count: number; topic: string | null; window_hours: number };
    };
    expect(body.items).toEqual([]);
    expect(body.meta.count).toBe(5);
    expect(body.meta.topic).toBe('geopolitics');
    expect(body.meta.window_hours).toBe(12);
  });

  it('clamps count + window to safe bounds', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/topnews?count=9999&window=99999&topic=sports'),
      makeEnv(),
    );
    const body = (await res!.json()) as {
      meta: { count: number; window_hours: number; topic: string | null };
    };
    expect(body.meta.count).toBe(50);
    expect(body.meta.window_hours).toBe(168);
    expect(body.meta.topic).toBeNull();
  });

  it('returns empty digests list when posts table is empty', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/digests'),
      makeEnv(),
    );
    const body = (await res!.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('404s when a specific cluster is missing', async () => {
    const res = await handleApiRequest(
      new Request('https://example.test/api/clusters/12345'),
      makeEnv(),
    );
    expect(res!.status).toBe(404);
  });
});
