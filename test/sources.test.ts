import { describe, expect, it } from 'vitest';
import { M1_FEEDS } from '../src/sources';

describe('sources', () => {
  it('M1_FEEDS has distinct ids and HTTPS URLs', () => {
    expect(M1_FEEDS.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(M1_FEEDS.map((f) => f.id));
    expect(ids.size).toBe(M1_FEEDS.length);
    for (const f of M1_FEEDS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });
});
