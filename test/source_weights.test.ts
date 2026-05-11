import { describe, expect, it } from 'vitest';
import {
  WEIGHT_HI,
  WEIGHT_LO,
  bindDigestSourceWindow,
  effectiveWeight,
  sqlWeightedSourceSumInWindow,
  weightedDistinctSourceSum,
} from '../src/source_weights';

describe('source_weights', () => {
  it('exports expected clamp constants', () => {
    expect(WEIGHT_LO).toBe(0.5);
    expect(WEIGHT_HI).toBe(1.5);
  });

  it('effectiveWeight blends toward 1.0 when reaction counts are low', () => {
    expect(effectiveWeight(1.5, 0, 0)).toBe(1);
    expect(effectiveWeight(0.5, 0, 0)).toBe(1);
  });

  it('effectiveWeight approaches raw weight as reactions accumulate', () => {
    const w = effectiveWeight(1.4, 25, 5);
    expect(w).toBeGreaterThan(1.35);
    expect(w).toBeLessThanOrEqual(1.4);
  });

  it('bindDigestSourceWindow matches digest window constant', () => {
    expect(bindDigestSourceWindow()).toBe('-12 hours');
  });

  it('sqlWeightedSourceSumInWindow returns a correlated subquery string', () => {
    const sql = sqlWeightedSourceSumInWindow();
    expect(sql).toContain('source_weights');
    expect(sql).toContain('a.cluster_id = c.id');
  });

  it('weightedDistinctSourceSum sums effective weights per source group', async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              { w: 1, pc: 0, nc: 0 },
              { w: 1.2, pc: 10, nc: 10 },
            ],
          }),
        }),
      }),
    } as unknown as D1Database;

    const sum = await weightedDistinctSourceSum(mockDb, 42, { hours: 12 });
    const e0 = effectiveWeight(1, 0, 0);
    const e1 = effectiveWeight(1.2, 10, 10);
    expect(sum).toBeCloseTo(e0 + e1);
  });
});
