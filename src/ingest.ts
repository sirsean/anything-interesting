import { bestMatchingClusterId } from './cluster';
import { sha256Hex } from './hash';
import { fetchFeedItems } from './rss';
import { M1_FEEDS } from './sources';

export type Env = {
  DB: D1Database;
  CONFIG: KVNamespace;
  DISCORD_WEBHOOK_URL?: string;
};

async function loadClusterCandidates(db: D1Database): Promise<{ id: number; representative_title: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, representative_title FROM clusters
       WHERE datetime(last_updated) >= datetime('now', '-7 days')
       ORDER BY last_updated DESC
       LIMIT 400`,
    )
    .all<{ id: number; representative_title: string }>();
  return results ?? [];
}

async function refreshClusterStats(db: D1Database, clusterId: number): Promise<void> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT source) AS d FROM articles WHERE cluster_id = ?`,
    )
    .bind(clusterId)
    .first<{ d: number }>();
  const distinct = row?.d ?? 0;
  const finalScore = Math.min(1, distinct / 5);
  await db
    .prepare(
      `UPDATE clusters
       SET last_updated = datetime('now'),
           source_weight_sum = ?,
           final_score = ?
       WHERE id = ?`,
    )
    .bind(distinct, finalScore, clusterId)
    .run();
}

export async function runIngest(env: Env): Promise<{ inserted: number; skippedDup: number }> {
  let inserted = 0;
  let skippedDup = 0;

  const feeds = await Promise.all(M1_FEEDS.map((s) => fetchFeedItems(s)));
  const candidates = await loadClusterCandidates(env.DB);

  for (let i = 0; i < M1_FEEDS.length; i++) {
    const source = M1_FEEDS[i];
    const items = feeds[i] ?? [];
    for (const item of items.slice(0, 50)) {
      const urlHash = await sha256Hex(item.url);
      const existing = await env.DB.prepare('SELECT 1 AS x FROM articles WHERE url_hash = ?').bind(urlHash).first<{ x: number }>();
      if (existing) {
        skippedDup += 1;
        continue;
      }

      const clusterId = bestMatchingClusterId(item.title, candidates);
      let cid: number;
      if (clusterId != null) {
        cid = clusterId;
      } else {
        const ins = await env.DB.prepare(
          `INSERT INTO clusters (representative_title, first_seen, last_updated, topic, source_weight_sum, final_score)
           VALUES (?, datetime('now'), datetime('now'), 'general', 0, 0)
           RETURNING id`,
        )
          .bind(item.title.slice(0, 500))
          .first<{ id: number }>();
        if (!ins?.id) continue;
        cid = ins.id;
        candidates.unshift({ id: cid, representative_title: item.title.slice(0, 500) });
      }

      await env.DB
        .prepare(
          `INSERT INTO articles (url_hash, url, title, source, fetched_at, published_at, cluster_id)
           VALUES (?, ?, ?, ?, datetime('now'), ?, ?)`,
        )
        .bind(urlHash, item.url, item.title.slice(0, 500), source.label, item.publishedAt, cid)
        .run();

      inserted += 1;
      await refreshClusterStats(env.DB, cid);
    }
  }

  return { inserted, skippedDup };
}
