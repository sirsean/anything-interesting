import { describe, expect, it, vi } from 'vitest';
import {
  CLUSTER_EVAL_PRESETS,
  cosineSimilarity,
  computeSimStats,
  InMemoryHeadlineIndex,
  PROD_CLUSTER_CONFIG,
  resolveClusterPick,
  simulateClustering,
  type ArticleInput,
} from '../src/cluster_sim';

describe('cluster_sim', () => {
  it('cosineSimilarity returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('auto-merges above cosineSame without rerank', async () => {
    const index = new InMemoryHeadlineIndex();
    index.upsert({
      id: 'a1',
      values: [1, 0, 0],
      clusterId: 5,
      repTitle: 'Story A',
      ts: 1000,
    });

    const { pick } = await resolveClusterPick({
      top: { score: 0.9, clusterId: 5, repTitle: 'Story A' },
      newTitle: 'Story A follow-up',
      config: PROD_CLUSTER_CONFIG,
      rerank: vi.fn(),
      clusterExists: () => true,
    });
    expect(pick).toEqual({ clusterId: 5 });
  });

  it('always_merge_gray merges gray zone without GLM same=true', async () => {
    const rerank = vi.fn().mockResolvedValue(false);
    const { pick, grayZone } = await resolveClusterPick({
      top: { score: 0.79, clusterId: 2, repTitle: 'Rep' },
      newTitle: 'New headline',
      config: CLUSTER_EVAL_PRESETS.tuned_b!,
      rerank,
      clusterExists: () => true,
    });
    expect(pick).toEqual({ clusterId: 2 });
    expect(grayZone?.merged).toBe(true);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('simulateClustering merges cross-source headlines with high similarity', async () => {
    const base = [1, 0, 0];
    const near = [0.99, 0.01, 0];
    const articles: ArticleInput[] = [
      {
        id: '1',
        title: 'Alpha strike hits port',
        source: 'BBC World',
        fetchedAt: '2026-07-01T10:00:00Z',
      },
      {
        id: '2',
        title: 'Alpha strike hits port — update',
        source: 'Guardian World',
        fetchedAt: '2026-07-01T11:00:00Z',
      },
    ];
    const embeddings = new Map([
      ['1', base],
      ['2', near],
    ]);

    const sim = await simulateClustering({
      articles,
      embeddings,
      config: { cosineSame: 0.82, cosineLow: 0.78, corpusDays: 7, grayZonePolicy: 'glm_required' },
      rerank: vi.fn().mockResolvedValue(true),
    });

    expect(sim.stats.clusterCount).toBe(1);
    expect(sim.stats.multiSourceClusters).toBe(1);
  });

  it('computeSimStats reports single-source majority for fragmented runs', () => {
    const stats = computeSimStats(
      [
        {
          id: 1,
          repTitle: 'A',
          firstSeenAt: '',
          articles: [
            { id: '1', title: 'A', source: 'S1', fetchedAt: '' },
            { id: '2', title: 'A2', source: 'S2', fetchedAt: '' },
          ],
        },
        {
          id: 2,
          repTitle: 'B',
          firstSeenAt: '',
          articles: [{ id: '3', title: 'B', source: 'S2', fetchedAt: '' }],
        },
      ],
      [],
    );
    expect(stats.singleSourceClusters).toBe(1);
    expect(stats.multiSourceClusters).toBe(1);
    expect(stats.singleSourcePct).toBeCloseTo(50);
  });
});
