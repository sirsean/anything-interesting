import { sha256Hex } from './hash';
import type { Env } from './env';
import { fetchFeed, type ParsedItem } from './rss';
import { NEWS_FEEDS, type FeedSource } from './sources';
import { pickClusterForHeadline, upsertHeadlineVector, makeGlmRerankFn, PROD_CLUSTER_CONFIG } from './cluster_embed';
import { InMemoryHeadlineIndex, decideClusterAssignment } from './cluster_sim';
import { inferTopicFromTitle } from './topic';
import { runEmbed } from './llm';
import { mapLimit, canonicalArticleUrl } from './http';
export type { Env } from './env';

type PendingArticle = {
  id: number; title: string; description: string; url_hash: string; cluster_id: number;
  content_hash: string; publisher: string; feed_id: string; enrichment_attempts: number; topic: string;
};
export async function storeIncomingArticle(env: Env, source: FeedSource, item: ParsedItem): Promise<'inserted' | 'updated' | 'duplicate' | 'stale'> {
  const url = canonicalArticleUrl(item.url);
  if (!url) return 'stale';
  const urlHash = await sha256Hex(url);
  const hash = await sha256Hex(JSON.stringify([item.title, item.description]));
  const existing = await env.DB.prepare('SELECT id, cluster_id, content_hash FROM articles WHERE url_hash = ? OR url = ? LIMIT 1')
    .bind(urlHash, url).first<{ id: number; cluster_id: number; content_hash: string | null }>();
  if (existing?.content_hash === hash) return 'duplicate';
  const published = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  if (!existing && Number.isFinite(published) && (published < Date.now() - 7 * 86400_000 || published > Date.now() + 3600_000)) return 'stale';
  if (existing) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE articles SET title = ?, description = ?, publisher = ?, feed_id = ?, content_type = ?,
        content_hash = ?, excerpt = '', enrichment_status = 'pending', enrichment_attempts = 0, next_enrichment_at = NULL,
        updated_at = datetime('now'), published_at = COALESCE(?, published_at) WHERE id = ?`)
        .bind(item.title, item.description, source.publisher ?? source.label, source.id, source.kind ?? 'reporting', hash, item.publishedAt, existing.id),
      env.DB.prepare(`UPDATE clusters SET judgment_status = 'pending', next_judgment_at = NULL,
        last_development_at = datetime('now'), last_updated = datetime('now') WHERE id = ?`).bind(existing.cluster_id),
    ]);
    return 'updated';
  }
  // A provisional cluster permits durable archival before any AI/network enrichment.
  const topic = source.topic === 'general' || !source.topic ? inferTopicFromTitle(item.title) : source.topic;
  const c = await env.DB.prepare(`INSERT INTO clusters (representative_title, topic, last_development_at) VALUES (?, ?, datetime('now')) RETURNING id`)
    .bind(item.title, topic).first<{ id: number }>();
  if (!c) throw new Error('Unable to create provisional story');
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO articles
    (url_hash, url, title, source, published_at, cluster_id, vec_id, publisher, feed_id, content_type, description, content_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .bind(urlHash, url, item.title, source.label, item.publishedAt, c.id, urlHash, source.publisher ?? source.label,
      source.id, source.kind ?? 'reporting', item.description, hash).run();
  return inserted.meta.changes ? 'inserted' : 'duplicate';
}

/** Interleave topics so fixed registry/order cannot monopolize pending work. */
export function fairByTopic<T extends { topic: string }>(rows: T[], limit: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) { const list = buckets.get(row.topic) ?? []; list.push(row); buckets.set(row.topic, list); }
  const out: T[] = [];
  while (out.length < limit) {
    let added = false;
    for (const list of buckets.values()) { const row = list.shift(); if (row) { out.push(row); added = true; if (out.length === limit) break; } }
    if (!added) break;
  }
  return out;
}
export async function enrichPendingArticles(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT a.id, a.title, a.description, a.url_hash, a.cluster_id, a.content_hash,
    a.publisher, a.feed_id, a.enrichment_attempts, c.topic, ROW_NUMBER() OVER (PARTITION BY c.topic ORDER BY a.enrichment_attempts ASC, a.updated_at DESC) AS topic_rank FROM articles a JOIN clusters c ON c.id = a.cluster_id
    WHERE a.enrichment_status = 'pending' AND (a.next_enrichment_at IS NULL OR datetime(a.next_enrichment_at) <= datetime('now'))
      AND datetime(COALESCE(a.published_at, a.fetched_at)) >= datetime('now', '-7 days')
    ORDER BY topic_rank ASC, a.enrichment_attempts ASC, a.updated_at DESC LIMIT 400`).all<PendingArticle>();
  const rows = fairByTopic(results ?? [], 40); let enriched = 0; const started = Date.now();
  const index = new InMemoryHeadlineIndex();
  for (let offset = 0; offset < rows.length; offset += 16) {
    const batch = rows.slice(offset, offset + 16);
    let vectors: number[][];
    try { vectors = await runEmbed(env, batch.map(a => `${a.title}\n${a.description.slice(0, 300)}`.slice(0, 800))); }
    catch { break; } // Already archived; pending rows survive the next tick.
    for (let i = 0; i < batch.length; i++) {
      if (Date.now() - started > 180_000) return enriched;
      const a = batch[i]; const vec = vectors[i];
      try {
        if (!vec?.length) throw new Error('Empty embedding');
        let pick = await pickClusterForHeadline(env, vec, a.title, env.DB);
        if ('newCluster' in pick) {
          pick = (await decideClusterAssignment({ index, embedding: vec, newTitle: a.title,
            config: PROD_CLUSTER_CONFIG, rerank: makeGlmRerankFn(env), tsSec: Math.floor(Date.now()/1000),
            clusterExists: () => true })).pick;
        }
        const cid = 'clusterId' in pick ? pick.clusterId : a.cluster_id;
        await upsertHeadlineVector(env, { vectorId: a.url_hash, values: vec, clusterId: cid, repTitle: a.title });
        await env.DB.batch([
          env.DB.prepare(`UPDATE articles SET cluster_id = ?, enriched_hash = content_hash, enrichment_status = 'ready', next_enrichment_at = NULL WHERE id = ? AND content_hash = ?`)
            .bind(cid, a.id, a.content_hash),
          env.DB.prepare(`UPDATE clusters SET judgment_status = 'pending', next_judgment_at = NULL,
            last_development_at = datetime('now'), last_updated = datetime('now') WHERE id = ?`).bind(cid),
        ]);
        if (cid !== a.cluster_id) await env.DB.prepare("DELETE FROM clusters WHERE id = ? AND editorial_json IS NULL AND posted_digest_id IS NULL AND flow_type != 'market_driven' AND NOT EXISTS (SELECT 1 FROM articles WHERE cluster_id = ?)").bind(a.cluster_id, a.cluster_id).run();
        index.upsert({ id: a.url_hash, values: vec, clusterId: cid, repTitle: a.title, ts: Math.floor(Date.now()/1000) });
        enriched++;
      } catch (error) {
        console.error('Article enrichment deferred', a.id, error instanceof Error ? error.message : 'failed');
        await env.DB.prepare(`UPDATE articles SET enrichment_attempts = enrichment_attempts + 1,
          next_enrichment_at = datetime('now', ?) WHERE id = ?`)
          .bind(`+${Math.min(720, 15 * 2 ** Math.min(a.enrichment_attempts, 5))} minutes`, a.id).run();
      }
    }
  }
  return enriched;
}
export async function runIngest(env: Env): Promise<{ inserted: number; updated: number; skippedDup: number; feedsFailed: number; enriched: number }> {
  let inserted = 0, updated = 0, skippedDup = 0, feedsFailed = 0;
  const feeds = await mapLimit(NEWS_FEEDS, 6, s => fetchFeed(s));
  for (let i = 0; i < NEWS_FEEDS.length; i++) {
    const source = NEWS_FEEDS[i], result = feeds[i]; let newItems = 0;
    if (result.error) feedsFailed++;
    // Leave D1 query headroom for clustering, analysis and delivery in the same tick.
    const newestItems = [...result.items].sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0)).slice(0, 6);
    for (const item of newestItems) {
      try {
        const state = await storeIncomingArticle(env, source, item);
        if (state === 'inserted') { inserted++; newItems++; }
        if (state === 'updated') updated++;
        if (state === 'duplicate') skippedDup++;
      } catch (e) { console.error('Article archival failed', source.id, e instanceof Error ? e.message : 'failed'); }
    }
    const newest = result.items.map(a => a.publishedAt).filter((d): d is string => !!d).sort().at(-1) ?? null;
    await env.DB.prepare(`INSERT INTO source_health (feed_id, label, publisher, topic, checked_at, last_success_at,
      newest_published_at, item_count, new_items, expected_interval_hours, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feed_id) DO UPDATE SET checked_at = excluded.checked_at,
      last_success_at = COALESCE(excluded.last_success_at, source_health.last_success_at),
      newest_published_at = COALESCE(excluded.newest_published_at, source_health.newest_published_at),
      item_count = excluded.item_count, new_items = excluded.new_items, error = excluded.error`)
      .bind(source.id, source.label, source.publisher ?? source.label, source.topic ?? 'general', result.checkedAt,
        result.error ? null : result.checkedAt, newest, result.items.length, newItems, source.expectedIntervalHours ?? 48, result.error).run();
  }
  return { inserted, updated, skippedDup, feedsFailed, enriched: await enrichPendingArticles(env) };
}
