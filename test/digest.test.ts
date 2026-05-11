import { describe, expect, it } from 'vitest';
import { EXCEPTIONAL_SCORE } from '../src/digest_constants';
import { digestClusterTitleLink, formatDigestLabel, pickDigestRows, type DigestCandidateRow } from '../src/digest';
import type { Env } from '../src/env';

function row(partial: Partial<DigestCandidateRow> & Pick<DigestCandidateRow, 'id' | 'final_score'>): DigestCandidateRow {
  return {
    id: partial.id,
    representative_title: partial.representative_title ?? 't',
    final_score: partial.final_score,
    topic: partial.topic ?? 'general',
    flow_type: partial.flow_type ?? 'news',
    polymarket_slug: partial.polymarket_slug ?? null,
    polymarket_price: partial.polymarket_price ?? null,
    polymarket_price_24h_ago: partial.polymarket_price_24h_ago ?? null,
    llm_reasoning_log: partial.llm_reasoning_log ?? null,
    source_weight_sum: partial.source_weight_sum ?? 3,
  };
}

describe('digest helpers', () => {
  it('digestClusterTitleLink is undefined without PUBLIC_SITE_URL', () => {
    expect(digestClusterTitleLink({} as Env, 7)).toBeUndefined();
  });

  it('digestClusterTitleLink joins base and cluster id', () => {
    const env = { PUBLIC_SITE_URL: 'https://example.test' } as Env;
    expect(digestClusterTitleLink(env, 42)).toBe('https://example.test/cluster/42');
  });

  it('digestClusterTitleLink trims base and strips trailing slashes', () => {
    const env = { PUBLIC_SITE_URL: '  https://example.test///  ' } as Env;
    expect(digestClusterTitleLink(env, 1)).toBe('https://example.test/cluster/1');
  });

  it('formatDigestLabel pads single-digit hours', () => {
    expect(formatDigestLabel('5')).toBe('05:00 CT');
    expect(formatDigestLabel('15')).toBe('15:00 CT');
  });

  it('pickDigestRows returns all rows when count ≤ 3', () => {
    const rows = [row({ id: 1, final_score: 0.9 }), row({ id: 2, final_score: 0.8 }), row({ id: 3, final_score: 0.7 })];
    expect(pickDigestRows(rows)).toEqual(rows);
  });

  it('pickDigestRows caps at 3 when fourth score is below exceptional', () => {
    const rows = [
      row({ id: 1, final_score: 0.95 }),
      row({ id: 2, final_score: 0.94 }),
      row({ id: 3, final_score: 0.93 }),
      row({ id: 4, final_score: EXCEPTIONAL_SCORE - 0.01 }),
    ];
    expect(pickDigestRows(rows)).toHaveLength(3);
    expect(pickDigestRows(rows).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('pickDigestRows allows fourth item when fourth score meets exceptional threshold', () => {
    const rows = [
      row({ id: 1, final_score: 0.95 }),
      row({ id: 2, final_score: 0.94 }),
      row({ id: 3, final_score: 0.93 }),
      row({ id: 4, final_score: EXCEPTIONAL_SCORE }),
    ];
    expect(pickDigestRows(rows)).toHaveLength(4);
  });
});
