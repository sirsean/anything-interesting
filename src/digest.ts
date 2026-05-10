import { postDigestWebhook, type DiscordEmbed } from './discord';
import {
  buildClusterDiscordEmbed,
  marketDrivenDescription,
  type ClusterRowForEmbed,
} from './discord_cluster_embed';
import {
  DIGEST_SOURCE_WINDOW_HOURS,
  EXCEPTIONAL_SCORE,
  MIN_DISTINCT_SOURCES,
  MIN_FINAL_SCORE,
} from './digest_constants';
import type { Env } from './env';
import { MODEL_GLM_FLASH, runLLM, textFromChatOut } from './llm';

type Row = ClusterRowForEmbed & { source_weight_sum: number };

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

function pickDigestRows(rows: Row[]): Row[] {
  if (rows.length <= 3) return rows;
  const fourth = rows[3];
  if (fourth && fourth.final_score >= EXCEPTIONAL_SCORE) {
    return rows.slice(0, 4);
  }
  return rows.slice(0, 3);
}

function formatDigestLabel(hourCT: string): string {
  const padded = hourCT.padStart(2, '0');
  return `${padded}:00 CT`;
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

    embeds.push(
      await buildClusterDiscordEmbed({
        db: env.DB,
        row: c,
        description: desc,
        footerTag: 'M3',
      }),
    );
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
