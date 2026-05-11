import { describe, expect, it, vi } from 'vitest';
import { pickClusterForHeadline } from '../src/cluster_embed';
import type { Env } from '../src/env';

describe('cluster_embed', () => {
  it('returns newCluster when Vectorize metadata points at a missing D1 row', async () => {
    const env = {
      HEADLINES: {
        query: vi.fn().mockResolvedValue({
          matches: [
            {
              score: 0.95,
              metadata: { cluster_id: 99999, rep_title: 'ghost', ts: Math.floor(Date.now() / 1000) },
            },
          ],
        }),
      },
    } as unknown as Env;

    const db = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM clusters WHERE id')) {
          return { bind: () => ({ first: vi.fn().mockResolvedValue(null) }) };
        }
        return { bind: () => ({ first: vi.fn() }) };
      }),
    } as unknown as D1Database;

    const pick = await pickClusterForHeadline(env, new Array(768).fill(0.01), 'Some headline', db);
    expect(pick).toEqual({ newCluster: true });
  });
});
