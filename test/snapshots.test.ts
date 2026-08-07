import { describe, expect, it } from 'vitest';
import { parseLlmReasoning, parseResearchSources } from '../src/api';
import { researchQueryFromMarketTitle, researchSourcesForLog } from '../src/market_research';
import { stripHtmlToText } from '../src/page_fetch';
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

describe('market research helpers', () => {
  it('researchQueryFromMarketTitle strips ? and resolution date tails', () => {
    expect(researchQueryFromMarketTitle('US x Iran diplomatic meeting by July 10, 2026?')).toBe(
      'US x Iran diplomatic meeting',
    );
  });

  it('researchSourcesForLog omits excerpts', () => {
    const logged = researchSourcesForLog([
      {
        title: 'Headline',
        url: 'https://example.com/a',
        source: 'example.com',
        age: '2 hours ago',
        snippet: 'snip',
        fetched: true,
        excerpt: 'long body text that must not be persisted',
      },
    ]);
    expect(logged).toEqual([
      {
        title: 'Headline',
        url: 'https://example.com/a',
        source: 'example.com',
        age: '2 hours ago',
        fetched: true,
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain('long body');
  });
});

describe('page_fetch stripHtmlToText', () => {
  it('strips scripts/styles and prefers article body', () => {
    const html = `
      <html><head><style>.x{color:red}</style><script>evil()</script></head>
      <body><nav>nav</nav>
      <article><p>Alpha &amp; beta</p><p>More text here about diplomacy.</p></article>
      <footer>foot</footer></body></html>`;
    const text = stripHtmlToText(html);
    expect(text).toContain('Alpha & beta');
    expect(text).toContain('diplomacy');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('color:red');
  });
});

describe('parseResearchSources + market summary reasoning', () => {
  it('parses research array from llm_reasoning_log', () => {
    const raw = JSON.stringify({
      summary: 'Talks resumed.',
      reason: 'Talks resumed.',
      score: 0.72,
      research: [
        {
          title: 'Diplomats meet',
          url: 'https://news.example/a',
          source: 'news.example',
          age: '1 hour ago',
          fetched: true,
        },
        { title: '', url: 'https://bad.example' },
      ],
    });
    expect(parseResearchSources(raw)).toEqual([
      {
        title: 'Diplomats meet',
        url: 'https://news.example/a',
        source: 'news.example',
        age: '1 hour ago',
        fetched: true,
      },
    ]);
  });

  it('parseLlmReasoning accepts summary when reason is absent', () => {
    expect(
      parseLlmReasoning(JSON.stringify({ summary: 'From market explainer', score: 0.55 })),
    ).toEqual({
      score: 0.55,
      reason: 'From market explainer',
      at: null,
    });
  });
});
