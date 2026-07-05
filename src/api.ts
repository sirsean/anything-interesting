import { DIGEST_SOURCE_WINDOW_HOURS, MIN_FINAL_SCORE } from './digest_constants';
import { digestStatusLabel, isDigestEligible } from './digest_status';
import type { Env } from './env';
import {
  KIMI_JUDGMENT_DAILY_CAP,
  getKimiJudgmentUsage,
  getKimiJudgmentUsageForDay,
  isKimiJudgmentDay,
  listKimiJudgmentUsage,
} from './kimi_budget';
import { WATCHLIST_D1_LOOKBACK_HOURS } from './market_store';
import {
  marketDisplayTitle,
  marketOutcomeLabel,
  polymarketEventUrl,
} from './polymarket';
import { bindDigestSourceWindow, sqlWeightedSourceSumInWindow } from './source_weights';

const ALLOWED_TOPICS = new Set(['geopolitics', 'politics', 'economics', 'technology']);

const TOPNEWS_DEFAULT_COUNT = 25;
const TOPNEWS_MAX_COUNT = 50;
const TOPNEWS_DEFAULT_WINDOW_HOURS = 24;
const TOPNEWS_MAX_WINDOW_HOURS = 24 * 7;
const DIGESTS_DEFAULT_LIMIT = 10;
const DIGESTS_MAX_LIMIT = 50;
const MARKETS_DEFAULT_LIMIT = 50;
const MARKETS_MAX_LIMIT = 150;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseTopicParam(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().trim();
  return ALLOWED_TOPICS.has(t) ? t : null;
}

/**
 * Subset of `clusters` columns + the joined posted digest timestamp + the
 * weighted-source coverage subquery + the grace-window flag. Same shape used
 * by `/api/topnews` and `/api/clusters/:id`.
 */
type ClusterApiRow = {
  id: number;
  representative_title: string;
  topic: string;
  flow_type: string;
  final_score: number;
  coverage_score: number;
  novelty_score: number;
  surprise_score: number;
  llm_score: number;
  source_weight_sum: number;
  polymarket_slug: string | null;
  polymarket_price: number | null;
  polymarket_price_24h_ago: number | null;
  polymarket_match_score: number;
  llm_reasoning_log: string | null;
  first_seen: string;
  last_updated: string;
  posted_digest_id: number | null;
  posted_digest_at: string | null;
  weighted_sources_12h: number;
  grace_ok: number;
};

const CLUSTER_BASE_SELECT = `c.id, c.representative_title, c.topic, c.flow_type,
                              c.final_score, c.coverage_score, c.novelty_score,
                              c.surprise_score, c.llm_score, c.source_weight_sum,
                              c.polymarket_slug, c.polymarket_price,
                              c.polymarket_price_24h_ago, c.polymarket_match_score,
                              c.llm_reasoning_log, c.first_seen, c.last_updated,
                              c.posted_digest_id,
                              p.digest_timestamp AS posted_digest_at`;

type TopArticleRow = {
  cluster_id: number;
  title: string;
  url: string;
  source: string;
  fetched_at: string;
};

async function fetchTopArticles(
  db: D1Database,
  clusterIds: number[],
): Promise<Map<number, TopArticleRow>> {
  if (clusterIds.length === 0) return new Map();
  const ph = clusterIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT a.cluster_id, a.title, a.url, a.source, a.fetched_at
       FROM articles a
       INNER JOIN (
         SELECT cluster_id, MAX(fetched_at) AS max_fetched_at
         FROM articles
         WHERE cluster_id IN (${ph})
         GROUP BY cluster_id
       ) m ON m.cluster_id = a.cluster_id AND m.max_fetched_at = a.fetched_at`,
    )
    .bind(...clusterIds)
    .all<TopArticleRow>();
  const out = new Map<number, TopArticleRow>();
  for (const r of results ?? []) {
    if (!out.has(r.cluster_id)) out.set(r.cluster_id, r);
  }
  return out;
}

type SourceRow = { cluster_id: number; source: string };

async function fetchSourcesByCluster(
  db: D1Database,
  clusterIds: number[],
): Promise<Map<number, string[]>> {
  if (clusterIds.length === 0) return new Map();
  const ph = clusterIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT DISTINCT cluster_id, source FROM articles
       WHERE cluster_id IN (${ph})
       ORDER BY cluster_id, source ASC`,
    )
    .bind(...clusterIds)
    .all<SourceRow>();
  const out = new Map<number, string[]>();
  for (const r of results ?? []) {
    const list = out.get(r.cluster_id) ?? [];
    list.push(r.source);
    out.set(r.cluster_id, list);
  }
  return out;
}

async function fetchMarketMeta(
  db: D1Database,
  slugs: string[],
): Promise<
  Map<
    string,
    {
      title: string;
      event_slug: string | null;
      event_title: string | null;
      group_item_title: string | null;
    }
  >
> {
  if (slugs.length === 0) return new Map();
  const ph = slugs.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT slug, title, event_slug, event_title, group_item_title
       FROM markets WHERE slug IN (${ph})`,
    )
    .bind(...slugs)
    .all<{
      slug: string;
      title: string;
      event_slug: string | null;
      event_title: string | null;
      group_item_title: string | null;
    }>();
  const out = new Map<
    string,
    {
      title: string;
      event_slug: string | null;
      event_title: string | null;
      group_item_title: string | null;
    }
  >();
  for (const r of results ?? []) {
    out.set(r.slug, {
      title: r.title,
      event_slug: r.event_slug,
      event_title: r.event_title,
      group_item_title: r.group_item_title,
    });
  }
  return out;
}

export type LlmReasoning = { score: number | null; reason: string; at: string | null };

export function parseLlmReasoning(raw: string | null): LlmReasoning | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { score?: number; reason?: string; at?: string };
    if (typeof j.reason !== 'string' && typeof j.score !== 'number') return null;
    return {
      score: typeof j.score === 'number' ? j.score : null,
      reason: typeof j.reason === 'string' ? j.reason : '',
      at: typeof j.at === 'string' ? j.at : null,
    };
  } catch {
    return null;
  }
}

export type ClusterApiItem = {
  id: number;
  representative_title: string;
  topic: string;
  flow_type: string;
  final_score: number;
  scores: {
    coverage: number;
    novelty: number;
    surprise: number;
    llm: number;
  };
  source_weight_sum: number;
  weighted_sources_12h: number;
  sources: string[];
  top_article: { title: string; url: string; source: string; fetched_at: string } | null;
  polymarket: {
    slug: string;
    event_slug: string | null;
    title: string | null;
    event_title: string | null;
    outcome_label: string | null;
    url: string;
    price_now: number | null;
    price_24h_ago: number | null;
    match_score: number;
  } | null;
  digest: {
    eligible: boolean;
    posted_digest_id: number | null;
    posted_at: string | null;
    status_label: string;
  };
  llm_reasoning: LlmReasoning | null;
  first_seen: string;
  last_updated: string;
};

function shapeClusterItem(
  row: ClusterApiRow,
  topArticle: TopArticleRow | undefined,
  sources: string[],
  marketMeta:
    | {
        title: string;
        event_slug: string | null;
        event_title: string | null;
        group_item_title: string | null;
      }
    | undefined,
  now: Date,
): ClusterApiItem {
  const polymarket =
    row.polymarket_slug == null
      ? null
      : {
          slug: row.polymarket_slug,
          event_slug: marketMeta?.event_slug ?? null,
          title: marketMeta?.title ?? null,
          event_title: marketMeta?.event_title ?? null,
          outcome_label:
            marketMeta != null
              ? marketOutcomeLabel({
                  title: marketMeta.title,
                  slug: row.polymarket_slug,
                  eventSlug: marketMeta.event_slug,
                  groupItemTitle: marketMeta.group_item_title,
                })
              : null,
          url: polymarketEventUrl(row.polymarket_slug, marketMeta?.event_slug),
          price_now: row.polymarket_price,
          price_24h_ago: row.polymarket_price_24h_ago,
          match_score: row.polymarket_match_score,
        };

  const eligible = isDigestEligible(row);
  const status_label = digestStatusLabel(row, now);

  return {
    id: row.id,
    representative_title: row.representative_title,
    topic: row.topic,
    flow_type: row.flow_type,
    final_score: row.final_score,
    scores: {
      coverage: row.coverage_score,
      novelty: row.novelty_score,
      surprise: row.surprise_score,
      llm: row.llm_score,
    },
    source_weight_sum: row.source_weight_sum,
    weighted_sources_12h: row.weighted_sources_12h,
    sources,
    top_article: topArticle
      ? {
          title: topArticle.title,
          url: topArticle.url,
          source: topArticle.source,
          fetched_at: topArticle.fetched_at,
        }
      : null,
    polymarket,
    digest: {
      eligible,
      posted_digest_id: row.posted_digest_id,
      posted_at: row.posted_digest_at,
      status_label,
    },
    llm_reasoning: parseLlmReasoning(row.llm_reasoning_log),
    first_seen: row.first_seen,
    last_updated: row.last_updated,
  };
}

async function shapeClustersBatch(
  db: D1Database,
  rows: ClusterApiRow[],
  now: Date,
): Promise<ClusterApiItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const slugs = [...new Set(rows.map((r) => r.polymarket_slug).filter((s): s is string => !!s))];
  const [topArticles, sourceMap, marketMeta] = await Promise.all([
    fetchTopArticles(db, ids),
    fetchSourcesByCluster(db, ids),
    fetchMarketMeta(db, slugs),
  ]);
  return rows.map((r) =>
    shapeClusterItem(
      r,
      topArticles.get(r.id),
      sourceMap.get(r.id) ?? [],
      r.polymarket_slug ? marketMeta.get(r.polymarket_slug) : undefined,
      now,
    ),
  );
}

async function handleTopNews(env: Env, url: URL, now: Date): Promise<Response> {
  const count = clampInt(url.searchParams.get('count'), TOPNEWS_DEFAULT_COUNT, 1, TOPNEWS_MAX_COUNT);
  const topic = parseTopicParam(url.searchParams.get('topic'));
  const windowHours = clampInt(
    url.searchParams.get('window'),
    TOPNEWS_DEFAULT_WINDOW_HOURS,
    1,
    TOPNEWS_MAX_WINDOW_HOURS,
  );

  const lastDigest = await env.CONFIG.get('cursors:last_digest_at');
  const weightedSub = sqlWeightedSourceSumInWindow();
  const windowBind = bindDigestSourceWindow();
  const lookback = `-${windowHours} hours`;

  let sql = `SELECT ${CLUSTER_BASE_SELECT},
                    ${weightedSub} AS weighted_sources_12h,
                    (CASE
                       WHEN ? IS NULL THEN 1
                       WHEN datetime(c.last_updated) >= datetime(?) THEN 1
                       ELSE 0
                     END) AS grace_ok
             FROM clusters c
             LEFT JOIN posts p ON p.id = c.posted_digest_id
             WHERE datetime(c.last_updated) >= datetime('now', ?)`;
  const binds: unknown[] = [windowBind, lastDigest, lastDigest, lookback];
  if (topic) {
    sql += ` AND lower(c.topic) = lower(?)`;
    binds.push(topic);
  }
  sql += ` ORDER BY c.final_score DESC, c.last_updated DESC LIMIT ?`;
  binds.push(count);

  const { results } = await env.DB.prepare(sql).bind(...binds).all<ClusterApiRow>();
  const items = await shapeClustersBatch(env.DB, results ?? [], now);

  return jsonResponse({
    items,
    meta: {
      count,
      topic,
      window_hours: windowHours,
      generated_at: now.toISOString(),
      digest_threshold: MIN_FINAL_SCORE,
      digest_source_window_hours: DIGEST_SOURCE_WINDOW_HOURS,
    },
  });
}

async function handleClusterDetail(env: Env, id: number, now: Date): Promise<Response> {
  if (!Number.isFinite(id) || id <= 0) {
    return errorResponse(400, 'Invalid cluster id');
  }
  const weightedSub = sqlWeightedSourceSumInWindow();
  const windowBind = bindDigestSourceWindow();
  const lastDigest = await env.CONFIG.get('cursors:last_digest_at');

  const row = await env.DB
    .prepare(
      `SELECT ${CLUSTER_BASE_SELECT},
              ${weightedSub} AS weighted_sources_12h,
              (CASE
                 WHEN ? IS NULL THEN 1
                 WHEN datetime(c.last_updated) >= datetime(?) THEN 1
                 ELSE 0
               END) AS grace_ok
       FROM clusters c
       LEFT JOIN posts p ON p.id = c.posted_digest_id
       WHERE c.id = ?`,
    )
    .bind(windowBind, lastDigest, lastDigest, id)
    .first<ClusterApiRow>();

  if (!row) {
    return errorResponse(404, 'Cluster not found');
  }

  const isMarketDriven = row.flow_type === 'market_driven';
  // Market-driven clusters cite supporting articles via a reference table (they
  // no longer steal articles into their own cluster_id).
  const articleSql = isMarketDriven
    ? `SELECT a.id, a.title, a.url, a.source, a.fetched_at, a.published_at
       FROM market_cluster_articles mca
       JOIN articles a ON a.id = mca.article_id
       WHERE mca.cluster_id = ?
       ORDER BY a.fetched_at DESC, a.id DESC`
    : `SELECT id, title, url, source, fetched_at, published_at
       FROM articles
       WHERE cluster_id = ?
       ORDER BY fetched_at DESC, id DESC`;

  const [items, articleRows] = await Promise.all([
    shapeClustersBatch(env.DB, [row], now),
    env.DB
      .prepare(articleSql)
      .bind(id)
      .all<{
        id: number;
        title: string;
        url: string;
        source: string;
        fetched_at: string;
        published_at: string | null;
      }>(),
  ]);

  return jsonResponse({
    cluster: items[0],
    articles: articleRows.results ?? [],
  });
}

async function handleDigests(env: Env, url: URL): Promise<Response> {
  const limit = clampInt(url.searchParams.get('limit'), DIGESTS_DEFAULT_LIMIT, 1, DIGESTS_MAX_LIMIT);

  const { results: posts } = await env.DB
    .prepare(
      `SELECT id, digest_timestamp, message_id, channel_kind
       FROM posts
       ORDER BY datetime(digest_timestamp) DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; digest_timestamp: string; message_id: string | null; channel_kind: string }>();

  if (!posts || posts.length === 0) {
    return jsonResponse({ items: [] });
  }

  const postIds = posts.map((p) => p.id);
  const ph = postIds.map(() => '?').join(',');
  const { results: clusterRows } = await env.DB
    .prepare(
      `SELECT c.id, c.representative_title, c.final_score, c.topic, c.flow_type, c.posted_digest_id
       FROM clusters c
       WHERE c.posted_digest_id IN (${ph})`,
    )
    .bind(...postIds)
    .all<{
      id: number;
      representative_title: string;
      final_score: number;
      topic: string;
      flow_type: string;
      posted_digest_id: number;
    }>();

  type DigestClusterEntry = {
    id: number;
    representative_title: string;
    final_score: number;
    topic: string;
    flow_type: string;
  };
  const clustersByPost = new Map<number, DigestClusterEntry[]>();
  for (const row of clusterRows ?? []) {
    const list = clustersByPost.get(row.posted_digest_id) ?? [];
    list.push({
      id: row.id,
      representative_title: row.representative_title,
      final_score: row.final_score,
      topic: row.topic,
      flow_type: row.flow_type,
    });
    clustersByPost.set(row.posted_digest_id, list);
  }

  return jsonResponse({
    items: posts.map((p) => ({
      id: p.id,
      digest_timestamp: p.digest_timestamp,
      message_id: p.message_id,
      channel_kind: p.channel_kind,
      clusters: (clustersByPost.get(p.id) ?? []).sort((a, b) => b.final_score - a.final_score),
    })),
  });
}

async function handleStats(env: Env, now: Date): Promise<Response> {
  const stats = await env.DB
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM articles WHERE datetime(fetched_at) >= datetime('now', '-24 hours')) AS articles_last_24h,
         (SELECT COUNT(DISTINCT source) FROM articles WHERE datetime(fetched_at) >= datetime('now', '-24 hours')) AS distinct_sources_last_24h,
         (SELECT COUNT(*) FROM clusters WHERE final_score >= ? AND posted_digest_id IS NULL) AS clusters_above_threshold,
         (SELECT COUNT(*) FROM clusters WHERE polymarket_slug IS NOT NULL AND datetime(last_updated) >= datetime('now', '-24 hours')) AS polymarket_matched_count,
         (SELECT COUNT(*) FROM markets WHERE datetime(last_seen_in_watchlist) >= datetime('now', ?)) AS watchlist_markets_count,
         (SELECT COUNT(*) FROM markets WHERE last_snapshot_at IS NOT NULL AND datetime(last_snapshot_at) >= datetime('now', '-24 hours')) AS snapshotted_markets_24h`,
    )
    .bind(MIN_FINAL_SCORE, `-${WATCHLIST_D1_LOOKBACK_HOURS} hours`)
    .first<{
      articles_last_24h: number;
      distinct_sources_last_24h: number;
      clusters_above_threshold: number;
      polymarket_matched_count: number;
      watchlist_markets_count: number;
      snapshotted_markets_24h: number;
    }>();

  const [lastDigest, kimi, watchlistKv] = await Promise.all([
    env.CONFIG.get('cursors:last_digest_at'),
    getKimiJudgmentUsage(env, now),
    env.CONFIG.get('watchlist:current'),
  ]);

  let watchlist_kv_slugs = 0;
  try {
    const j = watchlistKv ? (JSON.parse(watchlistKv) as { slugs?: string[] }) : null;
    watchlist_kv_slugs = Array.isArray(j?.slugs) ? j.slugs.length : 0;
  } catch {
    watchlist_kv_slugs = 0;
  }

  return jsonResponse({
    articles_last_24h: stats?.articles_last_24h ?? 0,
    distinct_sources_last_24h: stats?.distinct_sources_last_24h ?? 0,
    clusters_above_threshold: stats?.clusters_above_threshold ?? 0,
    polymarket_matched_count: stats?.polymarket_matched_count ?? 0,
    watchlist_markets_count: stats?.watchlist_markets_count ?? 0,
    snapshotted_markets_24h: stats?.snapshotted_markets_24h ?? 0,
    watchlist_kv_slugs,
    last_digest_at: lastDigest,
    digest_threshold: MIN_FINAL_SCORE,
    kimi: {
      judgment: {
        day: kimi.day,
        used: kimi.used,
        cap: kimi.cap,
        remaining: kimi.remaining,
      },
    },
    generated_at: now.toISOString(),
  });
}

type MarketListRow = {
  slug: string;
  title: string;
  category: string | null;
  yes_price: number | null;
  volume_24h: number | null;
  one_day_price_change: number | null;
  last_seen_in_watchlist: string;
  last_snapshot_at: string | null;
  price_24h_ago: number | null;
  linked_clusters: number;
  event_slug: string | null;
  event_title: string | null;
  group_item_title: string | null;
};

async function handleMarkets(env: Env, url: URL): Promise<Response> {
  const limit = clampInt(url.searchParams.get('limit'), MARKETS_DEFAULT_LIMIT, 1, MARKETS_MAX_LIMIT);
  const lookback = `-${WATCHLIST_D1_LOOKBACK_HOURS} hours`;

  const { results } = await env.DB
    .prepare(
      `SELECT m.slug, m.title, m.category, m.yes_price, m.volume_24h, m.one_day_price_change,
              m.last_seen_in_watchlist, m.last_snapshot_at, m.event_slug, m.event_title, m.group_item_title,
              (
                SELECT ms.price FROM market_snapshots ms
                WHERE ms.market_slug = m.slug
                  AND datetime(ms.taken_at) BETWEEN datetime('now', '-26 hours')
                                                AND datetime('now', '-22 hours')
                ORDER BY ABS(strftime('%s', ms.taken_at) - strftime('%s','now','-24 hours')) ASC
                LIMIT 1
              ) AS price_24h_ago,
              (SELECT COUNT(*) FROM clusters c WHERE c.polymarket_slug = m.slug) AS linked_clusters
       FROM markets m
       WHERE datetime(m.last_seen_in_watchlist) >= datetime('now', ?)
       ORDER BY COALESCE(m.volume_24h, 0) DESC, m.last_seen_in_watchlist DESC
       LIMIT ?`,
    )
    .bind(lookback, limit)
    .all<MarketListRow>();

  return jsonResponse({
    items: (results ?? []).map((r) => ({
      slug: r.slug,
      title: r.title,
      display_title: marketDisplayTitle({
        title: r.title,
        slug: r.slug,
        eventSlug: r.event_slug,
        eventTitle: r.event_title,
      }),
      outcome_label: marketOutcomeLabel({
        title: r.title,
        slug: r.slug,
        eventSlug: r.event_slug,
        groupItemTitle: r.group_item_title,
      }),
      category: r.category,
      event_slug: r.event_slug,
      event_title: r.event_title,
      yes_price: r.yes_price,
      price_24h_ago: r.price_24h_ago,
      one_day_price_change: r.one_day_price_change,
      volume_24h: r.volume_24h,
      last_seen_in_watchlist: r.last_seen_in_watchlist,
      last_snapshot_at: r.last_snapshot_at,
      linked_clusters: r.linked_clusters,
      url: polymarketEventUrl(r.slug, r.event_slug),
    })),
    meta: {
      limit,
      lookback_hours: WATCHLIST_D1_LOOKBACK_HOURS,
      generated_at: new Date().toISOString(),
    },
  });
}

async function handleMarketDetail(env: Env, slug: string): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT slug, title, description, category, end_date, yes_price, volume_24h,
              one_day_price_change, last_seen_in_watchlist, last_snapshot_at, first_seen, last_updated,
              event_slug, event_title, group_item_title
       FROM markets WHERE slug = ?`,
    )
    .bind(slug)
    .first<{
      slug: string;
      title: string;
      description: string | null;
      category: string | null;
      end_date: string | null;
      yes_price: number | null;
      volume_24h: number | null;
      one_day_price_change: number | null;
      last_seen_in_watchlist: string;
      last_snapshot_at: string | null;
      first_seen: string;
      last_updated: string;
      event_slug: string | null;
      event_title: string | null;
      group_item_title: string | null;
    }>();

  if (!row) {
    return errorResponse(404, 'Market not found');
  }

  const [snapshots, linkedClusters, price24h] = await Promise.all([
    env.DB
      .prepare(
        `SELECT price, volume_24h, taken_at FROM market_snapshots
         WHERE market_slug = ?
         ORDER BY datetime(taken_at) DESC LIMIT 48`,
      )
      .bind(slug)
      .all<{ price: number; volume_24h: number | null; taken_at: string }>(),
    env.DB
      .prepare(
        `SELECT id, representative_title, final_score, flow_type, last_updated
         FROM clusters WHERE polymarket_slug = ?
         ORDER BY final_score DESC LIMIT 12`,
      )
      .bind(slug)
      .all<{
        id: number;
        representative_title: string;
        final_score: number;
        flow_type: string;
        last_updated: string;
      }>(),
    env.DB
      .prepare(
        `SELECT price FROM market_snapshots
         WHERE market_slug = ?
           AND datetime(taken_at) BETWEEN datetime('now', '-26 hours')
                                     AND datetime('now', '-22 hours')
         ORDER BY ABS(strftime('%s', taken_at) - strftime('%s','now','-24 hours')) ASC
         LIMIT 1`,
      )
      .bind(slug)
      .first<{ price: number }>(),
  ]);

  return jsonResponse({
    market: {
      ...row,
      display_title: marketDisplayTitle({
        title: row.title,
        slug: row.slug,
        eventSlug: row.event_slug,
        eventTitle: row.event_title,
      }),
      outcome_label: marketOutcomeLabel({
        title: row.title,
        slug: row.slug,
        eventSlug: row.event_slug,
        groupItemTitle: row.group_item_title,
      }),
      price_24h_ago: price24h?.price ?? null,
      url: polymarketEventUrl(row.slug, row.event_slug),
    },
    snapshots: snapshots.results ?? [],
    linked_clusters: linkedClusters.results ?? [],
  });
}

async function handleKimiStats(env: Env, url: URL, now: Date): Promise<Response> {
  const dayParam = url.searchParams.get('day');
  if (dayParam !== null) {
    if (!isKimiJudgmentDay(dayParam)) {
      return errorResponse(400, 'Invalid day; use YYYY-MM-DD (UTC)');
    }
    const judgment = await getKimiJudgmentUsageForDay(env, dayParam);
    return jsonResponse({
      kimi: { judgment },
      generated_at: now.toISOString(),
    });
  }

  const items = await listKimiJudgmentUsage(env);
  return jsonResponse({
    kimi: {
      judgment: {
        cap: KIMI_JUDGMENT_DAILY_CAP,
        items: items.map(({ day, used, remaining }) => ({ day, used, remaining })),
      },
    },
    generated_at: now.toISOString(),
  });
}

/**
 * Routes any `GET /api/...` request. Returns `null` if the path doesn't match,
 * so the caller can fall through to the SPA static-asset binding.
 */
export async function handleApiRequest(req: Request, env: Env): Promise<Response | null> {
  if (req.method !== 'GET') {
    return null;
  }
  const url = new URL(req.url);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return null;

  const now = new Date();

  try {
    if (pathname === '/api/topnews') {
      return await handleTopNews(env, url, now);
    }
    if (pathname === '/api/digests') {
      return await handleDigests(env, url);
    }
    if (pathname === '/api/stats/kimi') {
      return await handleKimiStats(env, url, now);
    }
    if (pathname === '/api/stats') {
      return await handleStats(env, now);
    }
    if (pathname === '/api/markets') {
      return await handleMarkets(env, url);
    }
    const marketMatch = pathname.match(/^\/api\/markets\/([^/]+)$/);
    if (marketMatch) {
      return await handleMarketDetail(env, decodeURIComponent(marketMatch[1]));
    }
    const clusterMatch = pathname.match(/^\/api\/clusters\/(\d+)$/);
    if (clusterMatch) {
      const id = Number.parseInt(clusterMatch[1], 10);
      return await handleClusterDetail(env, id, now);
    }
    return errorResponse(404, 'Unknown API route');
  } catch (e) {
    console.error('api error', pathname, e);
    return errorResponse(500, 'API error');
  }
}
