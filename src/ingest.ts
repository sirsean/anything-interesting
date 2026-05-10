import { sha256Hex } from './hash';
import type { Env } from './env';
import { fetchFeedItems } from './rss';
import { M1_FEEDS } from './sources';
import { embedHeadline, pickClusterForHeadline, upsertHeadlineVector } from './cluster_embed';
import { inferTopicFromTitle } from './topic';
import { refreshClusterScores } from './scoring';

export type { Env } from './env';

export async function runIngest(env: Env): Promise<{ inserted: number; skippedDup: number }> {
  let inserted = 0;
  let skippedDup = 0;

  const feeds = await Promise.all(M1_FEEDS.map((s) => fetchFeedItems(s)));

  for (let i = 0; i < M1_FEEDS.length; i++) {
    const source = M1_FEEDS[i];
    const items = feeds[i] ?? [];
    for (const item of items.slice(0, 50)) {
      const urlHash = await sha256Hex(item.url);
      const existing = await env.DB
        .prepare('SELECT 1 AS x FROM articles WHERE url_hash = ?')
        .bind(urlHash)
        .first<{ x: number }>();
      if (existing) {
        skippedDup += 1;
        continue;
      }

      let vec: number[];
      try {
        vec = await embedHeadline(env, item.title);
      } catch (e) {
        console.error('embed failed', e);
        continue;
      }

      let pick;
      try {
        pick = await pickClusterForHeadline(env, vec, item.title, env.DB);
      } catch (e) {
        console.error('cluster pick failed', e);
        continue;
      }

      let cid: number;
      if ('clusterId' in pick) {
        cid = pick.clusterId;
      } else {
        const topic = inferTopicFromTitle(item.title);
        const ins = await env.DB
          .prepare(
            `INSERT INTO clusters (representative_title, first_seen, last_updated, topic, source_weight_sum, final_score,
             coverage_score, novelty_score, surprise_score, llm_score, judged_distinct_sources)
             VALUES (?, datetime('now'), datetime('now'), ?, 0, 0, 0, 0, 0, 0, 0)
             RETURNING id`,
          )
          .bind(item.title.slice(0, 500), topic)
          .first<{ id: number }>();
        if (!ins?.id) continue;
        cid = ins.id;
      }

      await env.DB
        .prepare(
          `INSERT INTO articles (url_hash, url, title, source, fetched_at, published_at, cluster_id, vec_id)
           VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
        )
        .bind(
          urlHash,
          item.url,
          item.title.slice(0, 500),
          source.label,
          item.publishedAt,
          cid,
          urlHash,
        )
        .run();

      try {
        await upsertHeadlineVector(env, {
          vectorId: urlHash,
          values: vec,
          clusterId: cid,
          repTitle: item.title,
        });
      } catch (e) {
        console.error('vector upsert failed', e);
      }

      inserted += 1;
      await refreshClusterScores(env, cid);
    }
  }

  return { inserted, skippedDup };
}
