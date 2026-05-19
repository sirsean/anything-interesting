import { postDigestWebhook, type DiscordEmbed } from './discord';
import {
  buildClusterDiscordEmbed,
  marketDrivenDescription,
  type ClusterRowForEmbed,
} from './discord_cluster_embed';
import { EXCEPTIONAL_SCORE, MIN_FINAL_SCORE, MIN_WEIGHTED_SOURCE_COVERAGE } from './digest_constants';
import { bindDigestSourceWindow, sqlWeightedSourceSumInWindow } from './source_weights';
import type { Env } from './env';
import { MODEL_GLM_FLASH, runLLM, textFromChatOut } from './llm';

export type DigestCandidateRow = ClusterRowForEmbed & { source_weight_sum: number };

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

async function loadCandidateClusters(db: D1Database, lastDigestIso: string | null): Promise<DigestCandidateRow[]> {
  const graceSql =
    lastDigestIso == null
      ? `1 = 1`
      : `datetime(c.last_updated) >= datetime(?)`;

  // Market-driven items get to bypass the distinct-source gate; the price-move
  // signal stands in for source coverage by design (see INITIAL.md Strategy B).
  const weightedSub = sqlWeightedSourceSumInWindow();
  const windowBind = bindDigestSourceWindow();

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
           OR ${weightedSub} >= ?
         )
       ORDER BY c.final_score DESC, c.last_updated DESC
       LIMIT 8`,
    )
    .bind(
      MIN_FINAL_SCORE,
      ...(lastDigestIso == null ? [] : [lastDigestIso]),
      windowBind,
      MIN_WEIGHTED_SOURCE_COVERAGE,
    )
    .all<DigestCandidateRow>();

  return results ?? [];
}

/** Caps digest items at 3, or 4 when the fourth cluster is exceptionally scored. */
export function pickDigestRows(rows: DigestCandidateRow[]): DigestCandidateRow[] {
  if (rows.length <= 3) return rows;
  const fourth = rows[3];
  if (fourth && fourth.final_score >= EXCEPTIONAL_SCORE) {
    return rows.slice(0, 4);
  }
  return rows.slice(0, 3);
}

export function formatDigestLabel(hourCT: string): string {
  const padded = hourCT.padStart(2, '0');
  return `${padded}:00 CT`;
}

/** Absolute cluster detail URL for the public SPA; undefined when `PUBLIC_SITE_URL` is unset. */
export function digestClusterTitleLink(env: Env, clusterId: number): string | undefined {
  const base = env.PUBLIC_SITE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/cluster/${clusterId}`;
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

  const label = formatDigestLabel(hourCT);

  const digestTs = new Date().toISOString();
  const clusterIdsJson = JSON.stringify(clusters.map((c) => c.id));

  const postRow = await env.DB
    .prepare(
      `INSERT INTO posts (digest_timestamp, cluster_ids, message_id, channel_kind)
       VALUES (?, ?, NULL, 'webhook')
       RETURNING id`,
    )
    .bind(digestTs, clusterIdsJson)
    .first<{ id: number }>();

  const postId = postRow?.id;
  if (!postId) {
    console.error('Failed to insert posts row before Discord delivery');
    return;
  }

  let firstMessageId: string | undefined;

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
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

    const embed = await buildClusterDiscordEmbed({
      db: env.DB,
      row: c,
      description: desc,
      titleLinkUrl: digestClusterTitleLink(env, c.id),
    });
    const hint = '👍/👎 on this message tunes outlet weights.';
    embed.footer.text = `${embed.footer.text} · ${hint}`.slice(0, 2048);

    const content =
      i === 0
        ? `${label} digest — ${clusters.length} item${clusters.length === 1 ? '' : 's'}`
        : '';

    const posted = await postDigestWebhook(webhook, content, [embed]);
    if (!posted.ok) {
      console.error('Discord webhook failed', posted.status, posted.body, 'cluster', c.id);
      await env.DB.prepare('DELETE FROM post_cluster_messages WHERE post_id = ?').bind(postId).run();
      await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
      return;
    }

    const mid = posted.messageId;
    if (mid) {
      if (i === 0) firstMessageId = mid;
      await env.DB
        .prepare(
          `INSERT INTO post_cluster_messages (post_id, cluster_id, message_id) VALUES (?, ?, ?)`,
        )
        .bind(postId, c.id, mid)
        .run();
    }
  }

  await env.DB
    .prepare(`UPDATE posts SET message_id = ? WHERE id = ?`)
    .bind(firstMessageId ?? null, postId)
    .run();

  const stmt = env.DB.prepare('UPDATE clusters SET posted_digest_id = ? WHERE id = ?');
  await env.DB.batch(clusters.map((c) => stmt.bind(postId, c.id)));

  await env.CONFIG.put('cursors:last_digest_at', digestTs);
  console.log(`Digest posted post_id=${postId} clusters=${clusters.length}`);
}
