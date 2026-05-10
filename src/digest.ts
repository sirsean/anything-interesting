import { postDigestWebhook, type DiscordEmbed } from './discord';
import type { Env } from './env';
import { MODEL_GLM_FLASH, runLLM, textFromChatOut } from './llm';

const DIGEST_SOURCE_WINDOW_HOURS = 12;
const MIN_DISTINCT_SOURCES = 3;
const MIN_FINAL_SCORE = 0.6;
const EXCEPTIONAL_SCORE = 0.88;

type Row = {
  id: number;
  representative_title: string;
  final_score: number;
  source_weight_sum: number;
  topic: string;
  flow_type: string;
  polymarket_slug: string | null;
  polymarket_price: number | null;
  polymarket_price_24h_ago: number | null;
  llm_reasoning_log: string | null;
};

type MarketRow = {
  slug: string;
  title: string;
};

async function summarizeForDiscord(
  env: Env,
  title: string,
  url: string,
  rep: string,
): Promise<string> {
  try {
    const raw = await runLLM(
      env,
      'digest_summary',
      MODEL_GLM_FLASH,
      [
        {
          role: 'system',
          content:
            'Write 1–2 short sentences for a Discord embed description. Neutral wire tone, no markdown, no links.',
        },
        {
          role: 'user',
          content: `Latest headline: ${title.slice(0, 400)}\nURL: ${url.slice(0, 200)}\nCluster line: ${rep.slice(0, 400)}`,
        },
      ],
      { max_tokens: 180, temperature: 0.35 },
    );
    const t = textFromChatOut(raw).trim();
    if (t.length > 0) return t.slice(0, 4090);
  } catch (e) {
    console.error('digest summary GLM failed', e);
  }
  return `${rep.slice(0, 220)}${rep.length > 220 ? '…' : ''}`;
}

/** Pulls the Kimi-written explainer that `snapshots.ts` stashes in llm_reasoning_log. */
function marketDrivenDescription(rep: string, c: Row): string {
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

async function loadCandidateClusters(db: D1Database, lastDigestIso: string | null): Promise<Row[]> {
  const graceSql =
    lastDigestIso == null
      ? `1 = 1`
      : `datetime(c.last_updated) >= datetime(?)`;

  // Market-driven items get to bypass the distinct-source gate; the price-move
  // signal stands in for source coverage by design (see INITIAL.md Strategy B).
  const { results } = await db
    .prepare(
      `SELECT c.id, c.representative_title, c.final_score, c.source_weight_sum, c.topic,
              c.flow_type, c.polymarket_slug, c.polymarket_price, c.polymarket_price_24h_ago,
              c.llm_reasoning_log
       FROM clusters c
       WHERE c.posted_digest_id IS NULL
         AND c.final_score >= ?
         AND (${graceSql})
         AND (
           c.flow_type = 'market_driven'
           OR (
             SELECT COUNT(DISTINCT a.source)
             FROM articles a
             WHERE a.cluster_id = c.id
               AND datetime(a.fetched_at) >= datetime('now', ?)
           ) >= ?
         )
       ORDER BY c.final_score DESC, c.last_updated DESC
       LIMIT 8`,
    )
    .bind(
      MIN_FINAL_SCORE,
      ...(lastDigestIso == null ? [] : [lastDigestIso]),
      `-${DIGEST_SOURCE_WINDOW_HOURS} hours`,
      MIN_DISTINCT_SOURCES,
    )
    .all<Row>();

  return results ?? [];
}

async function loadMarketTitle(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT title FROM markets WHERE slug = ?`)
    .bind(slug)
    .first<{ title: string }>();
  return row?.title ?? null;
}

function polymarketField(
  c: Row,
  marketTitle: string | null,
): { name: string; value: string; inline: boolean } {
  if (!c.polymarket_slug) {
    return { name: 'Polymarket', value: '—', inline: false };
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

function pickDigestRows(rows: Row[]): Row[] {
  if (rows.length <= 3) return rows;
  const fourth = rows[3];
  if (fourth && fourth.final_score >= EXCEPTIONAL_SCORE) {
    return rows.slice(0, 4);
  }
  return rows.slice(0, 3);
}

async function sourcesLine(db: D1Database, clusterId: number): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT source FROM articles WHERE cluster_id = ? ORDER BY source ASC`,
    )
    .bind(clusterId)
    .all<{ source: string }>();
  const labels = (results ?? []).map((r) => r.source);
  return labels.join(', ') || '—';
}

function formatDigestLabel(hourCT: string): string {
  const padded = hourCT.padStart(2, '0');
  return `${padded}:00 CT`;
}

function topicLabel(t: string): string {
  if (!t) return 'General';
  return t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();
}

export async function deliverDigest(env: Env, hourCT: string): Promise<void> {
  const webhook = env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.warn('DISCORD_WEBHOOK_URL missing; skip digest delivery');
    return;
  }

  const lastDigest = await env.CONFIG.get('cursors:last_digest_at');
  const rows = await loadCandidateClusters(env.DB, lastDigest);
  const clusters = pickDigestRows(rows);

  if (clusters.length === 0) {
    console.log('Digest: no eligible clusters (quiet run)');
    return;
  }

  const embeds: DiscordEmbed[] = [];
  for (const c of clusters) {
    const isMarketDriven = c.flow_type === 'market_driven';
    const sources = await sourcesLine(env.DB, c.id);
    const top = await env.DB
      .prepare(
        `SELECT url, title FROM articles WHERE cluster_id = ? ORDER BY fetched_at DESC LIMIT 1`,
      )
      .bind(c.id)
      .first<{ url: string; title: string }>();

    const baseTitle = (top?.title ?? c.representative_title).slice(0, 240);
    const title = (isMarketDriven ? `📈 ${baseTitle}` : baseTitle).slice(0, 256);
    const url = top?.url
      ?? (c.polymarket_slug
        ? `https://polymarket.com/event/${encodeURIComponent(c.polymarket_slug)}`
        : 'https://polymarket.com');
    const desc = isMarketDriven
      ? marketDrivenDescription(c.representative_title, c)
      : await summarizeForDiscord(env, title, url, c.representative_title);

    const marketTitle = c.polymarket_slug ? await loadMarketTitle(env.DB, c.polymarket_slug) : null;
    const flavor = isMarketDriven ? 'market-driven' : 'news-driven';

    embeds.push({
      title,
      url,
      description: desc,
      color: isMarketDriven ? 3447003 : 15844367,
      fields: [
        { name: 'Topic', value: topicLabel(c.topic), inline: true },
        {
          name: 'Sources',
          value: (sources || (isMarketDriven ? '(no matched articles)' : '—')).slice(0, 1000),
          inline: true,
        },
        polymarketField(c, marketTitle),
      ],
      footer: {
        text: `Score: ${c.final_score.toFixed(2)} · ${flavor} · M3`,
      },
    });
  }

  const label = formatDigestLabel(hourCT);
  const content = `${label} digest — ${embeds.length} item${embeds.length === 1 ? '' : 's'}`;

  const posted = await postDigestWebhook(webhook, content, embeds);
  if (!posted.ok) {
    console.error('Discord webhook failed', posted.status, posted.body);
    return;
  }

  const digestTs = new Date().toISOString();
  const clusterIds = JSON.stringify(clusters.map((c) => c.id));

  const row = await env.DB.prepare(
    `INSERT INTO posts (digest_timestamp, cluster_ids, message_id, channel_kind)
     VALUES (?, ?, ?, 'webhook')
     RETURNING id`,
  )
    .bind(digestTs, clusterIds, posted.messageId ?? null)
    .first<{ id: number }>();

  const postId = row?.id;
  if (!postId) {
    console.error('Failed to insert posts row after Discord success');
    return;
  }

  const stmt = env.DB.prepare('UPDATE clusters SET posted_digest_id = ? WHERE id = ?');
  await env.DB.batch(clusters.map((c) => stmt.bind(postId, c.id)));

  await env.CONFIG.put('cursors:last_digest_at', digestTs);
  console.log(`Digest posted post_id=${postId} clusters=${clusters.length}`);
}
