import { describe, expect, it } from 'vitest';
import { MIN_FINAL_SCORE, MIN_WEIGHTED_SOURCE_COVERAGE } from '../src/digest_constants';
import { digestStatusLabel, isDigestEligible, type DigestStatusRow } from '../src/digest_status';

function row(partial: Partial<DigestStatusRow>): DigestStatusRow {
  return {
    final_score: partial.final_score ?? 0.7,
    flow_type: partial.flow_type ?? 'news_driven',
    posted_digest_id: partial.posted_digest_id ?? null,
    posted_digest_at: partial.posted_digest_at ?? null,
    weighted_sources_12h: partial.weighted_sources_12h ?? MIN_WEIGHTED_SOURCE_COVERAGE,
    grace_ok: partial.grace_ok ?? 1,
  };
}

describe('isDigestEligible', () => {
  it('rejects already-posted clusters regardless of score', () => {
    expect(isDigestEligible(row({ posted_digest_id: 7, final_score: 0.95 }))).toBe(false);
  });

  it('rejects below-threshold scores', () => {
    expect(
      isDigestEligible(row({ final_score: MIN_FINAL_SCORE - 0.0001 })),
    ).toBe(false);
  });

  it('rejects clusters outside the grace window', () => {
    expect(isDigestEligible(row({ grace_ok: 0 }))).toBe(false);
  });

  it('accepts market-driven clusters even with no source coverage', () => {
    expect(
      isDigestEligible(
        row({ flow_type: 'market_driven', weighted_sources_12h: 0 }),
      ),
    ).toBe(true);
  });

  it('rejects news-driven clusters under the weighted-coverage gate', () => {
    expect(
      isDigestEligible(row({ weighted_sources_12h: MIN_WEIGHTED_SOURCE_COVERAGE - 0.01 })),
    ).toBe(false);
  });

  it('accepts news-driven clusters at or above the weighted-coverage gate', () => {
    expect(
      isDigestEligible(row({ weighted_sources_12h: MIN_WEIGHTED_SOURCE_COVERAGE })),
    ).toBe(true);
  });
});

describe('digestStatusLabel', () => {
  it('reports the slot when posted_digest_at is present', () => {
    const at = '2026-05-10T20:00:00Z'; // 15:00 CT (CDT)
    const label = digestStatusLabel(
      row({ posted_digest_id: 1, posted_digest_at: at }),
    );
    expect(label).toMatch(/^Posted in \d{2}:00 CT digest$/);
  });

  it('falls back to a generic label when posted_digest_at is missing', () => {
    expect(digestStatusLabel(row({ posted_digest_id: 1 }))).toBe('Posted in a recent digest');
  });

  it('shows the next scheduled slot for eligible clusters', () => {
    const noon = new Date('2026-05-10T17:00:00Z'); // 12:00 CT → next slot is 15:00
    expect(digestStatusLabel(row({}), noon)).toBe('In upcoming 15:00 CT digest');
  });

  it('shows below-threshold for ineligible un-posted clusters', () => {
    expect(digestStatusLabel(row({ final_score: 0.2 }))).toBe('Below digest threshold');
  });
});
