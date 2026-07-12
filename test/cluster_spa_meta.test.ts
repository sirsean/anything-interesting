import { describe, expect, it } from 'vitest';
import {
  buildClusterShareDescription,
  buildClusterShareTitle,
  fetchClusterShareMeta,
  handleClusterSpaPage,
} from '../src/cluster_spa_meta';
import type { Env } from '../src/env';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="generic" />
    <title>Anything Interesting</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function makeEnv(opts: {
  clusterRow?: Record<string, unknown> | null;
  topArticleTitle?: string | null;
} = {}): Env {
  const fakeDb = {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM clusters')) return opts.clusterRow ?? null;
          if (sql.includes('FROM articles')) {
            return opts.topArticleTitle != null ? { title: opts.topArticleTitle } : null;
          }
          return null;
        },
      }),
    }),
  } as unknown as D1Database;

  const fakeAssets = {
    fetch: async () =>
      new Response(INDEX_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  } as unknown as Fetcher;

  return { DB: fakeDb, ASSETS: fakeAssets } as Env;
}

describe('buildClusterShareTitle', () => {
  it('uses top article title for news clusters', () => {
    expect(buildClusterShareTitle('Rep line', 'Wire headline', 'news')).toBe('Wire headline');
  });

  it('prefixes market-driven clusters', () => {
    expect(buildClusterShareTitle('Will X happen?', null, 'market_driven')).toBe('📈 Will X happen?');
  });
});

describe('buildClusterShareDescription', () => {
  it('prefers LLM reason for news clusters', () => {
    expect(
      buildClusterShareDescription({
        representative_title: 'Rep',
        flow_type: 'news',
        llm_reasoning_log: JSON.stringify({ reason: 'Because it matters' }),
        polymarket_price: null,
        polymarket_price_24h_ago: null,
      }),
    ).toBe('Because it matters');
  });

  it('falls back to representative title', () => {
    expect(
      buildClusterShareDescription({
        representative_title: 'Rep line',
        flow_type: 'news',
        llm_reasoning_log: null,
        polymarket_price: null,
        polymarket_price_24h_ago: null,
      }),
    ).toBe('Rep line');
  });
});

describe('fetchClusterShareMeta', () => {
  it('returns null when cluster missing', async () => {
    await expect(fetchClusterShareMeta(makeEnv(), 99)).resolves.toBeNull();
  });

  it('shapes title and description from D1', async () => {
    const meta = await fetchClusterShareMeta(
      makeEnv({
        clusterRow: {
          id: 7,
          representative_title: 'Rep',
          topic: 'geopolitics',
          flow_type: 'news',
          llm_reasoning_log: JSON.stringify({ reason: 'Escalation risk' }),
          polymarket_price: null,
          polymarket_price_24h_ago: null,
        },
        topArticleTitle: 'Breaking wire',
      }),
      7,
    );
    expect(meta).toEqual({
      title: 'Breaking wire',
      description: 'Escalation risk',
      topic: 'Geopolitics',
    });
  });
});

describe('handleClusterSpaPage', () => {
  it('injects cluster-specific meta tags into the SPA shell', async () => {
    const env = makeEnv({
      clusterRow: {
        id: 42,
        representative_title: 'Cluster rep',
        topic: 'politics',
        flow_type: 'news',
        llm_reasoning_log: null,
        polymarket_price: null,
        polymarket_price_24h_ago: null,
      },
      topArticleTitle: 'Headline for preview',
    });
    env.PUBLIC_SITE_URL = 'https://example.test';

    const res = await handleClusterSpaPage(
      new Request('https://example.test/cluster/42'),
      env,
      '42',
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<title>Headline for preview · Anything Interesting</title>');
    expect(html).toContain('property="og:title" content="Headline for preview"');
    expect(html).toContain('property="og:description" content="Cluster rep"');
    expect(html).toContain('property="og:url" content="https://example.test/cluster/42"');
    expect(html).toContain('name="twitter:title" content="Headline for preview"');
  });

  it('serves generic shell when cluster is missing', async () => {
    const res = await handleClusterSpaPage(
      new Request('https://example.test/cluster/999'),
      makeEnv(),
      '999',
    );
    const html = await res.text();
    expect(html).toContain('<title>Anything Interesting</title>');
    expect(html).not.toContain('property="og:title"');
  });
});
