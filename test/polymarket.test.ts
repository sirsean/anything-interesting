import { describe, expect, it } from 'vitest';
import {
  biggestMoverToGamma,
  marketDisplayTitle,
  marketOutcomeLabel,
  normalizeMarket,
  polymarketEventUrl,
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

  it('extracts parent event slug for neg-risk outcome markets', () => {
    const w = normalizeMarket({
      id: '2063131',
      slug: 'will-alesa-mengesha-be-the-next-prime-minister-of-ethiopia',
      question: 'Will Alesa Mengesha be the next Prime Minister of Ethiopia?',
      groupItemTitle: 'Alesa Mengesha',
      outcomes: '["Yes", "No"]',
      outcomePrices: '["0.002", "0.998"]',
      closed: false,
      events: [
        {
          slug: 'next-prime-minister-of-ethiopia',
          title: 'Next Prime Minister of Ethiopia?',
        },
      ],
    } as GammaMarket);
    expect(w!.eventSlug).toBe('next-prime-minister-of-ethiopia');
    expect(w!.groupItemTitle).toBe('Alesa Mengesha');
    expect(marketDisplayTitle(w!)).toBe('Next Prime Minister of Ethiopia?');
    expect(marketOutcomeLabel(w!)).toBe('Alesa Mengesha');
    expect(polymarketEventUrl(w!.slug, w!.eventSlug)).toBe(
      'https://polymarket.com/event/next-prime-minister-of-ethiopia',
    );
  });

  it('passes parent event through biggest-movers mapping', () => {
    const row: BiggestMoverMarket = {
      id: '1',
      slug: 'will-trump-speak-to-ahmed-al-sharaa-in-june',
      question: 'Will Trump speak to Ahmed al-Sharaa in June?',
      closed: false,
      events: [{ slug: 'who-will-trump-speak-to-in-june', title: 'Who will Trump speak to in June?' }],
    };
    const w = normalizeMarket(biggestMoverToGamma(row, 'politics'));
    expect(w!.eventSlug).toBe('who-will-trump-speak-to-in-june');
  });
});
