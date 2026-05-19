import { describe, expect, it, vi } from 'vitest';
import {
  buildClusterDiscordEmbed,
  marketDrivenDescription,
  polymarketField,
  topicLabel,
  type ClusterRowForEmbed,
} from '../src/discord_cluster_embed';

function cluster(partial: Partial<ClusterRowForEmbed> & Pick<ClusterRowForEmbed, 'id'>): ClusterRowForEmbed {
  return {
    id: partial.id,
    representative_title: partial.representative_title ?? 'Rep',
    final_score: partial.final_score ?? 0.7,
    topic: partial.topic ?? 'general',
    flow_type: partial.flow_type ?? 'news',
    polymarket_slug: partial.polymarket_slug ?? null,
    polymarket_price: partial.polymarket_price ?? null,
    polymarket_price_24h_ago: partial.polymarket_price_24h_ago ?? null,
    llm_reasoning_log: partial.llm_reasoning_log ?? null,
  };
}

function mockDbForEmbed(): D1Database {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: [{ source: 'BBC' }] }),
        first: vi.fn().mockResolvedValue(
          sql.includes('FROM markets')
            ? null
            : { url: 'https://news.example/article', title: 'Wire headline' },
        ),
      }),
    })),
  } as unknown as D1Database;
}

describe('discord_cluster_embed', () => {
  it('buildClusterDiscordEmbed uses titleLinkUrl as embed url when provided', async () => {
    const embed = await buildClusterDiscordEmbed({
      db: mockDbForEmbed(),
      row: cluster({ id: 99, polymarket_slug: null }),
      description: 'Body',
      titleLinkUrl: 'https://ui.example/cluster/99',
    });
    expect(embed.url).toBe('https://ui.example/cluster/99');
  });

  it('buildClusterDiscordEmbed falls back to top article url when titleLinkUrl omitted', async () => {
    const embed = await buildClusterDiscordEmbed({
      db: mockDbForEmbed(),
      row: cluster({ id: 99, polymarket_slug: null }),
      description: 'Body',
    });
    expect(embed.url).toBe('https://news.example/article');
  });

  it('topicLabel title-cases non-empty topics', () => {
    expect(topicLabel('')).toBe('General');
    expect(topicLabel('economics')).toBe('Economics');
  });

  it('polymarketField returns null when no slug', () => {
    expect(polymarketField(cluster({ id: 1, polymarket_slug: null }), null)).toBeNull();
  });

  it('polymarketField includes markdown link and delta arrow', () => {
    const f = polymarketField(
      cluster({
        id: 1,
        polymarket_slug: 'my-event',
        polymarket_price: 0.55,
        polymarket_price_24h_ago: 0.45,
      }),
      'Nice Title',
    );
    expect(f).not.toBeNull();
    if (f === null) throw new Error('expected polymarket field');
    expect(f.value).toContain('https://polymarket.com/event/');
    expect(f.value).toContain('Nice Title');
    expect(f.value).toContain('↑');
  });

  it('buildClusterDiscordEmbed omits Polymarket field when cluster has no market slug', async () => {
    const embed = await buildClusterDiscordEmbed({
      db: mockDbForEmbed(),
      row: cluster({ id: 99, polymarket_slug: null }),
      description: 'Body',
    });
    expect(embed.fields.map((x) => x.name)).toEqual(['Topic', 'Sources']);
  });

  it('marketDrivenDescription uses JSON summary when valid', () => {
    const c = cluster({
      id: 1,
      llm_reasoning_log: JSON.stringify({ summary: 'From log' }),
    });
    expect(marketDrivenDescription('Rep title', c)).toContain('From log');
  });

  it('marketDrivenDescription appends price move when no summary but prices exist', () => {
    const c = cluster({
      id: 1,
      llm_reasoning_log: null,
      polymarket_price: 0.6,
      polymarket_price_24h_ago: 0.5,
    });
    const d = marketDrivenDescription('Headline text', c);
    expect(d).toContain('50%');
    expect(d).toContain('60%');
  });
});
