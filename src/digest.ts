import { postDigestWebhook, type DiscordEmbed } from './discord';
import type { Env } from './ingest';

const DIGEST_SOURCE_WINDOW_HOURS = 12;
const MIN_DISTINCT_SOURCES = 3;
const MAX_ITEMS = 3;

type EligibleCluster = {
  id: number;
  representative_title: string;
  final_score: number;
  source_weight_sum: number;
};

async function loadEligibleClusters(db: D1Database): Promise<EligibleCluster[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.representative_title, c.final_score, c.source_weight_sum
       FROM clusters c
       WHERE c.posted_digest_id IS NULL
         AND (
           SELECT COUNT(DISTINCT a.source)
           FROM articles a
           WHERE a.cluster_id = c.id
             AND datetime(a.fetched_at) >= datetime('now', ?)
         ) >= ?
       ORDER BY c.final_score DESC, c.last_updated DESC
       LIMIT ?`,
    )
    .bind(`-${DIGEST_SOURCE_WINDOW_HOURS} hours`, MIN_DISTINCT_SOURCES, MAX_ITEMS)
    .all<EligibleCluster>();

  return results ?? [];
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

export async function deliverDigest(env: Env, hourCT: string): Promise<void> {
  const webhook = env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.warn('DISCORD_WEBHOOK_URL missing; skip digest delivery');
    return;
  }

  const clusters = await loadEligibleClusters(env.DB);
  if (clusters.length === 0) {
    console.log('Digest: no eligible clusters (quiet run)');
    return;
  }

  const embeds: DiscordEmbed[] = [];
  for (const c of clusters) {
    const sources = await sourcesLine(env.DB, c.id);
    const top = await env.DB
      .prepare(
        `SELECT url, title FROM articles WHERE cluster_id = ? ORDER BY fetched_at DESC LIMIT 1`,
      )
      .bind(c.id)
      .first<{ url: string; title: string }>();

    embeds.push({
      title: (top?.title ?? c.representative_title).slice(0, 256),
      url: top?.url ?? 'https://example.invalid',
      description:
        'M1 digest — summaries arrive in M2 (Workers AI). Representative headline from clustered RSS items.',
      color: 15844367,
      fields: [
        { name: 'Topic', value: 'general', inline: true },
        { name: 'Sources', value: sources.slice(0, 1000), inline: true },
        {
          name: 'Polymarket',
          value: '— (M3)',
          inline: false,
        },
      ],
      footer: { text: `Score: ${c.final_score.toFixed(2)} · news-driven · M1` },
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
