import { describe, expect, it } from 'vitest';
import { keywordsFromTitle } from '../src/snapshots';

describe('snapshots keywordsFromTitle', () => {
  it('drops date tokens and generic market boilerplate', () => {
    const kw = keywordsFromTitle('US x Iran diplomatic meeting by July 10, 2026?');
    // "july", "2026", "meeting" must be filtered so they cannot LIKE-match
    // unrelated headlines (World Cup 2026, July 4th heatwave, etc.).
    expect(kw).not.toContain('july');
    expect(kw).not.toContain('2026');
    expect(kw).not.toContain('meeting');
    expect(kw).toContain('diplomatic');
    // Short but distinctive proper nouns (4 chars) are kept.
    expect(kw).toContain('iran');
  });

  it('drops president/election boilerplate that matched unrelated stories', () => {
    const kw = keywordsFromTitle('Tamas Sulyok out as President of Hungary by July 31?');
    expect(kw).not.toContain('president');
    expect(kw).not.toContain('july');
    // Distinctive proper nouns survive.
    expect(kw).toContain('sulyok');
    expect(kw).toContain('hungary');
  });

  it('keeps distinctive tokens and rejects pure numbers', () => {
    const kw = keywordsFromTitle('Iran successfully targets shipping by July 7?');
    expect(kw).not.toContain('july');
    expect(kw).not.toContain('targets');
    expect(kw).not.toContain('successfully');
    expect(kw).toContain('shipping');
    expect(kw).toContain('iran');
    for (const w of kw) {
      expect(w.length).toBeGreaterThanOrEqual(4);
      expect(/^\d+$/.test(w)).toBe(false);
    }
  });
});
