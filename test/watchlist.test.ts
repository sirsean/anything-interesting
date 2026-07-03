import { describe, expect, it } from 'vitest';
import {
  REFRESH_AFTER_HOURS,
  needsWatchlistRefresh,
  parseWatchlistKv,
} from '../src/watchlist';

describe('watchlist helpers', () => {
  describe('parseWatchlistKv', () => {
    it('returns slugs from valid JSON', () => {
      expect(parseWatchlistKv('{"slugs":["a","b"]}')).toEqual(['a', 'b']);
    });

    it('returns empty array on missing or invalid JSON', () => {
      expect(parseWatchlistKv(null)).toEqual([]);
      expect(parseWatchlistKv('not-json')).toEqual([]);
      expect(parseWatchlistKv('{"nope":1}')).toEqual([]);
    });
  });

  describe('needsWatchlistRefresh', () => {
    const now = Date.parse('2026-07-03T18:00:00.000Z');

    it('forces refresh when force=true', () => {
      expect(
        needsWatchlistRefresh({
          force: true,
          cursorIso: '2026-07-03T17:00:00.000Z',
          kvSlugs: ['x'],
          nowMs: now,
        }),
      ).toBe(true);
    });

    it('refreshes when KV slugs are empty even if cursor is recent', () => {
      expect(
        needsWatchlistRefresh({
          force: false,
          cursorIso: '2026-07-03T17:00:00.000Z',
          kvSlugs: [],
          nowMs: now,
        }),
      ).toBe(true);
    });

    it('skips refresh when cursor is within the refresh window and KV has slugs', () => {
      expect(
        needsWatchlistRefresh({
          force: false,
          cursorIso: '2026-07-03T17:00:00.000Z',
          kvSlugs: ['a'],
          nowMs: now,
        }),
      ).toBe(false);
    });

    it('refreshes when cursor is older than REFRESH_AFTER_HOURS', () => {
      const old = new Date(now - (REFRESH_AFTER_HOURS + 1) * 3600000).toISOString();
      expect(
        needsWatchlistRefresh({
          force: false,
          cursorIso: old,
          kvSlugs: ['a'],
          nowMs: now,
        }),
      ).toBe(true);
    });
  });
});
