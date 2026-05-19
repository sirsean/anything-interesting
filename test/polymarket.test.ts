import { describe, expect, it } from 'vitest';
import {
  biggestMoverToGamma,
  normalizeMarket,
  type BiggestMoverMarket,
  type GammaMarket,
} from '../src/polymarket';

describe('polymarket normalizeMarket', () => {
  it('returns null when slug missing or market closed/archived', () => {
    expect(normalizeMarket({ id: '1', slug: '' } as GammaMarket)).toBeNull();
    expect(normalizeMarket({ id: '1', slug: 'x', closed: true, question: 'Q?' } as GammaMarket)).toBeNull();
    expect(normalizeMarket({ id: '1', slug: 'x', archived: true, question: 'Q?' } as GammaMarket)).toBeNull();
  });

  it('returns null when question text is empty', () => {
    expect(
      normalizeMarket({
        id: '1',
        slug: 'evt',
        question: '   ',
        closed: false,
      } as GammaMarket),
    ).toBeNull();
  });

  it('prefers Yes outcome index for token and price arrays', () => {
    const m: GammaMarket = {
      id: '1',
      slug: 'multi',
      question: 'Will it rain?',
      outcomes: '["No","Yes"]',
      outcomePrices: '["0.2","0.8"]',
      clobTokenIds: '["token-no","token-yes"]',
      closed: false,
    };
    const w = normalizeMarket(m);
    expect(w).not.toBeNull();
    expect(w!.yesTokenId).toBe('token-yes');
    expect(w!.yesPrice).toBeCloseTo(0.8);
  });

  it('uses lastTradePrice when present', () => {
    const w = normalizeMarket({
      id: '1',
      slug: 'p',
      question: 'Q?',
      lastTradePrice: 0.34,
      closed: false,
    } as GammaMarket);
    expect(w!.yesPrice).toBeCloseTo(0.34);
  });

  it('biggestMoverToGamma maps breaking API rows for normalizeMarket', () => {
    const row: BiggestMoverMarket = {
      id: '1992868',
      slug: 'will-jerome-powell-depart-as-fed-chair-between-may-15-and-may-22',
      question: 'Will Jerome Powell depart as Fed Chair between May 15 and May 22?',
      outcomePrices: ['0.947', '0.053'],
      clobTokenIds: ['yes-token', 'no-token'],
      oneDayPriceChange: 0.4485,
      currentPrice: 0.947,
      closed: false,
      events: [{ volume: 240209.94 }],
    };
    const g = biggestMoverToGamma(row, 'politics');
    const w = normalizeMarket(g);
    expect(w).not.toBeNull();
    expect(w!.yesPrice).toBeCloseTo(0.947);
    expect(w!.yesTokenId).toBe('yes-token');
    expect(w!.tagLabels).toContain('politics');
    expect(w!.category).toBe('politics');
  });

  it('normalizes tag labels to trimmed lowercase strings', () => {
    const w = normalizeMarket({
      id: '1',
      slug: 't',
      question: 'Q?',
      tags: [{ label: 'Politics' }, { slug: 'ELECTIONS' }],
      closed: false,
    } as GammaMarket);
    expect(w!.tagLabels).toEqual(['politics', 'elections']);
  });
});
