import type { DiscordEmbed } from './discord';

export type ClusterRowForEmbed = {
  id: number;
  representative_title: string;
  final_score: number;
  topic: string;
  flow_type: string;
  polymarket_slug: string | null;
  polymarket_price: number | null;
  polymarket_price_24h_ago: number | null;
  llm_reasoning_log: string | null;
};

export function topicLabel(t: string): string {
  if (!t) return 'General';
  return t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();
}

/** Pulls the Kimi-written explainer that `snapshots.ts` stashes in llm_reasoning_log. */
export function marketDrivenDescription(rep: string, c: ClusterRowForEmbed): string {
  let summary: string | null = null;
  if (c.llm_reasoning_log) {
    try {
      const j = JSON.parse(c.llm_reasoning_log) as { summary?: string };
      if (typeof j.summary === 'string' && j.summary.trim().length > 0) {
        summary = j.summary.trim();
      }
    } catch {
      /* not JSON — ignore */
    }
  }
  const base = summary ?? `${rep.slice(0, 220)}${rep.length > 220 ? '…' : ''}`;
  if (
    c.polymarket_price != null &&
    c.polymarket_price_24h_ago != null &&
    summary == null
  ) {
    const now = (c.polymarket_price * 100).toFixed(0);
    const prev = (c.polymarket_price_24h_ago * 100).toFixed(0);
    return `${base} Polymarket YES moved ${prev}% → ${now}% over the last 24h.`;
  }
  return base.slice(0, 4090);
}

export async function loadMarketTitle(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT title FROM markets WHERE slug = ?`)
    .bind(slug)
    .first<{ title: string }>();
  return row?.title ?? null;
}

export function polymarketField(
  c: ClusterRowForEmbed,
  marketTitle: string | null,
): { name: string; value: string; inline: boolean } | null {
  if (!c.polymarket_slug) {
    return null;
  }
  const url = `https://polymarket.com/event/${encodeURIComponent(c.polymarket_slug)}`;
  const title = (marketTitle ?? c.polymarket_slug).slice(0, 200);
  const now = c.polymarket_price;
  const prev = c.polymarket_price_24h_ago;
  let priceLine = '';
  if (now != null) {
    const pct = `${(now * 100).toFixed(0)}%`;
    if (prev != null) {
      const delta = (now - prev) * 100;
      const arrow = delta >= 0 ? '↑' : '↓';
      priceLine = ` — ${pct} (${arrow}${Math.abs(delta).toFixed(0)}% 24h)`;
    } else {
      priceLine = ` — ${pct}`;
    }
  }
  return {
    name: 'Polymarket',
    value: `[${title}](${url})${priceLine}`.slice(0, 1024),
    inline: false,
  };
}

export async function sourcesLine(db: D1Database, clusterId: number): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT source FROM articles WHERE cluster_id = ? ORDER BY source ASC`,
    )
    .bind(clusterId)
    .all<{ source: string }>();
  const labels = (results ?? []).map((r) => r.source);
  return labels.join(', ') || '—';
}

export type ClusterEmbedBuildInput = {
  db: D1Database;
  row: ClusterRowForEmbed;
  /** Embed description body (digest uses GLM; interactions use fallbacks). */
  description: string;
  /** Short tail for footer, e.g. `M3` (digest) or `on-demand` (slash). */
  footerTag: string;
  /**
   * When set, used as the embed `url` (title hyperlink). Otherwise the top article URL or Polymarket event.
   */
  titleLinkUrl?: string;
};

export async function buildClusterDiscordEmbed(input: ClusterEmbedBuildInput): Promise<DiscordEmbed> {
  const { db, row: c, description, footerTag, titleLinkUrl } = input;
  const isMarketDriven = c.flow_type === 'market_driven';
  const sources = await sourcesLine(db, c.id);
  const top = await db
    .prepare(
      `SELECT url, title FROM articles WHERE cluster_id = ? ORDER BY fetched_at DESC LIMIT 1`,
    )
    .bind(c.id)
    .first<{ url: string; title: string }>();

  const baseTitle = (top?.title ?? c.representative_title).slice(0, 240);
  const title = (isMarketDriven ? `📈 ${baseTitle}` : baseTitle).slice(0, 256);

  const trimmedTitleLink = titleLinkUrl?.trim();
  let url: string;
  if (trimmedTitleLink) {
    url = trimmedTitleLink;
  } else {
    const articleUrl = top?.url;
    if (articleUrl != null) {
      url = articleUrl;
    } else if (c.polymarket_slug) {
      url = `https://polymarket.com/event/${encodeURIComponent(c.polymarket_slug)}`;
    } else {
      url = 'https://polymarket.com';
    }
  }

  const marketTitle = c.polymarket_slug ? await loadMarketTitle(db, c.polymarket_slug) : null;
  const polymarket = polymarketField(c, marketTitle);
  const flavor = isMarketDriven ? 'market-driven' : 'news-driven';

  const fields = [
    { name: 'Topic', value: topicLabel(c.topic), inline: true },
    {
      name: 'Sources',
      value: (sources || (isMarketDriven ? '(no matched articles)' : '—')).slice(0, 1000),
      inline: true,
    },
    ...(polymarket ? [polymarket] : []),
  ];

  return {
    title,
    url,
    description: description.slice(0, 4090),
    color: isMarketDriven ? 3447003 : 15844367,
    fields,
    footer: {
      text: `Score: ${c.final_score.toFixed(2)} · ${flavor} · ${footerTag}`,
    },
  };
}
