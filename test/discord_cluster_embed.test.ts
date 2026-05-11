import { describe, expect, it } from 'vitest';
import {
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

describe('discord_cluster_embed', () => {
  it('topicLabel title-cases non-empty topics', () => {
    expect(topicLabel('')).toBe('General');
    expect(topicLabel('economics')).toBe('Economics');
  });

  it('polymarketField renders dash when no slug', () => {
    const f = polymarketField(cluster({ id: 1, polymarket_slug: null }), null);
    expect(f.value).toBe('—');
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
    expect(f.value).toContain('https://polymarket.com/event/');
    expect(f.value).toContain('Nice Title');
    expect(f.value).toContain('↑');
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
