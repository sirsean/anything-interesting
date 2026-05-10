/**
 * Hourly Polymarket snapshot writer + Strategy B (markets → news) sweep.
 *
 * - For every slug in the current watchlist, hit Gamma for fresh metadata,
 *   write a `market_snapshots` row, then prune anything older than 14 days.
 * - Compare new price to the closest snapshot from ~24h ago. Flag movers
 *   beyond `>4% absolute` or `>25% relative` (per `INITIAL.md`).
 * - For each flagged market, do a keyword search over the last 24h of
 *   articles, ask Kimi to write a "what likely happened" explainer, and
 *   create / update a `flow_type='market_driven'` cluster with the explainer
 *   as the representative summary and an attached article (if any).
 */
import type { Env } from './env';
import { MODEL_KIMI_JUDGE, runLLM, textFromChatOut } from './llm';
import { fetchMarketBySlug, normalizeMarket, type WatchMarket } from './polymarket';
import { inferTopicFromTitle, topicalWeight } from './topic';
import { loadWatchlistSlugs } from './watchlist';

const RETENTION_DAYS = 14;
const ABSOLUTE_MOVE_THRESHOLD = 0.04;
const RELATIVE_MOVE_THRESHOLD = 0.25;
const STRATEGY_B_KIMI_CAP = 4;

type MarketRow = {
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  yes_token_id: string | null;
};

type SnapshotInput = {
  slug: string;
  title: string;
  description: string;
  category: string;
  yesTokenId: string | null;
  yesPrice: number | null;
  volume24h: number | null;
};

function inputFromWatchMarket(m: WatchMarket): SnapshotInput {
  return {
    slug: m.slug,
    title: m.title,
    description: m.description,
    category: m.category,
    yesTokenId: m.yesTokenId,
    yesPrice: m.yesPrice,
    volume24h: m.volume24h,
  };
}

async function loadWatchlistRows(env: Env, slugs: string[]): Promise<MarketRow[]> {
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => '?').join(',');
  const { results } = await env.DB
    .prepare(
      `SELECT slug, title, description, category, yes_token_id
       FROM markets WHERE slug IN (${placeholders})`,
    )
    .bind(...slugs)
    .all<MarketRow>();
  return results ?? [];
}

async function recordSnapshot(env: Env, m: SnapshotInput): Promise<void> {
  if (m.yesPrice == null) return;
  await env.DB
    .prepare(
      `INSERT INTO market_snapshots (market_slug, price, volume_24h, taken_at)
       VALUES (?, ?, ?, datetime('now'))`,
    )
    .bind(m.slug, m.yesPrice, m.volume24h ?? null)
    .run();
}

async function pruneOldSnapshots(env: Env): Promise<void> {
  await env.DB
    .prepare(
      `DELETE FROM market_snapshots
       WHERE datetime(taken_at) < datetime('now', ?)`,
    )
    .bind(`-${RETENTION_DAYS} days`)
    .run();
}

/**
 * Closest snapshot in the [22h, 26h] window — used as the 24h-ago baseline
 * for Strategy B price-move comparisons. Returns null if none.
 */
async function priorPrice(env: Env, slug: string): Promise<number | null> {
  const row = await env.DB
    .prepare(
      `SELECT price FROM market_snapshots
       WHERE market_slug = ?
         AND datetime(taken_at) BETWEEN datetime('now', '-26 hours')
                                   AND datetime('now', '-22 hours')
       ORDER BY ABS(strftime('%s', taken_at) - strftime('%s','now','-24 hours')) ASC
       LIMIT 1`,
    )
    .bind(slug)
    .first<{ price: number }>();
  return row?.price ?? null;
}

function isFlaggedMove(now: number, prev: number): boolean {
  const abs = Math.abs(now - prev);
  if (abs > ABSOLUTE_MOVE_THRESHOLD) return true;
  if (prev > 0) {
    const rel = abs / Math.max(0.01, prev);
    if (rel > RELATIVE_MOVE_THRESHOLD) return true;
  }
  return false;
}

/** Cheap deterministic keyword extraction for article search (no LLM). */
function keywordsFromTitle(title: string): string[] {
  const stop = new Set([
    'a','an','the','of','in','on','at','for','to','and','or','by','with','will','be',
    'is','are','was','were','do','does','vs','from','before','after','than','this',
    'that','these','those','its','it','as','if','any','no','any','more','less','can',
    'should','would','could','have','has','had','about','into','than','what','when',
    'where','who','which','why','how','than','then','also','not','but','their',
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
  return Array.from(new Set(words)).slice(0, 5);
}

type ArticleHit = {
  id: number;
  title: string;
  url: string;
  source: string;
};

async function searchArticles(env: Env, keywords: string[]): Promise<ArticleHit[]> {
  if (keywords.length === 0) return [];
  const clauses = keywords.map(() => 'lower(title) LIKE ?').join(' OR ');
  const params = keywords.map((k) => `%${k.toLowerCase()}%`);
  const { results } = await env.DB
    .prepare(
      `SELECT id, title, url, source FROM articles
       WHERE datetime(fetched_at) >= datetime('now', '-24 hours')
         AND (${clauses})
       ORDER BY fetched_at DESC LIMIT 6`,
    )
    .bind(...params)
    .all<ArticleHit>();
  return results ?? [];
}

async function kimiExplain(
  env: Env,
  market: SnapshotInput,
  prev: number,
  now: number,
  hits: ArticleHit[],
): Promise<{ summary: string; score: number }> {
  const direction = now > prev ? 'up' : 'down';
  const move = `${(prev * 100).toFixed(0)}% → ${(now * 100).toFixed(0)}%`;
  const articleLines = hits
    .slice(0, 4)
    .map((h) => `- ${h.source}: ${h.title.slice(0, 240)}`)
    .join('\n');
  const userBody =
    `Polymarket question: ${market.title}\n` +
    `Category: ${market.category || '(none)'}\n` +
    `YES probability moved ${direction}: ${move}\n` +
    (articleLines
      ? `Recent matching articles (24h):\n${articleLines}`
      : 'No matching articles found in the last 24h.');

  let raw: unknown;
  try {
    raw = await runLLM(
      env,
      'market_explain',
      MODEL_KIMI_JUDGE,
      [
        {
          role: 'system',
          content:
            'You explain a notable Polymarket price move for a precision-first news digest. Reply JSON only: {"summary":"1-2 sentences, neutral wire tone","score":0.0-1.0 newsworthiness}. If there is no clear news catalyst, say so plainly and lower the score.',
        },
        { role: 'user', content: userBody },
      ],
      { max_tokens: 240, temperature: 0.3, response_format: { type: 'json_object' } },
    );
  } catch (e) {
    console.error('Kimi market explain failed', market.slug, e);
    return { summary: '', score: 0 };
  }
  const txt = textFromChatOut(raw);
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { summary: txt.slice(0, 400), score: 0.4 };
  try {
    const j = JSON.parse(m[0]) as { summary?: string; score?: number };
    const score = typeof j.score === 'number' ? Math.max(0, Math.min(1, j.score)) : 0.4;
    const summary = (j.summary ?? '').toString().slice(0, 1800);
    return { summary, score };
  } catch {
    return { summary: txt.slice(0, 400), score: 0.4 };
  }
}

async function upsertMarketDrivenCluster(
  env: Env,
  market: SnapshotInput,
  prev: number,
  now: number,
  hits: ArticleHit[],
  explanation: { summary: string; score: number },
): Promise<void> {
  const surpriseAbs = Math.abs(now - prev);
  let surprise = Math.min(1, surpriseAbs / 0.15);
  const nearFifty = Math.max(0, 1 - Math.abs(0.5 - prev) / 0.5);
  surprise = Math.min(1, surprise + 0.25 * nearFifty * Math.min(1, surpriseAbs / 0.05));

  const topic = inferTopicFromTitle(market.title);
  const tw = topicalWeight(topic);
  const llm = explanation.score;
  const coverage = Math.min(1, hits.length / 3);
  const novelty = 1;
  const final = tw * (0.1 * coverage + 0.15 * novelty + 0.3 * surprise + 0.45 * llm);

  const repTitle = market.title.slice(0, 500);
  const log = JSON.stringify({
    summary: explanation.summary,
    score: explanation.score,
    move: { prev, now },
    at: new Date().toISOString(),
    hits: hits.length,
  }).slice(0, 4000);

  const existing = await env.DB
    .prepare(
      `SELECT id FROM clusters
       WHERE polymarket_slug = ? AND flow_type = 'market_driven'
       ORDER BY last_updated DESC LIMIT 1`,
    )
    .bind(market.slug)
    .first<{ id: number }>();

  let clusterId: number;
  if (existing?.id) {
    clusterId = existing.id;
    await env.DB
      .prepare(
        `UPDATE clusters
         SET last_updated = datetime('now'),
             representative_title = ?,
             topic = ?,
             coverage_score = ?,
             novelty_score = ?,
             surprise_score = ?,
             llm_score = ?,
             final_score = ?,
             polymarket_match_score = 1.0,
             polymarket_price = ?,
             polymarket_price_24h_ago = ?,
             llm_reasoning_log = ?,
             judged_distinct_sources = ?
         WHERE id = ?`,
      )
      .bind(
        repTitle,
        topic,
        coverage,
        novelty,
        surprise,
        llm,
        final,
        now,
        prev,
        log,
        hits.length,
        clusterId,
      )
      .run();
  } else {
    const ins = await env.DB
      .prepare(
        `INSERT INTO clusters (representative_title, first_seen, last_updated, topic,
            source_weight_sum, coverage_score, novelty_score, surprise_score,
            llm_score, final_score, polymarket_slug, flow_type,
            polymarket_match_score, polymarket_price, polymarket_price_24h_ago,
            llm_reasoning_log, judged_distinct_sources)
         VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, 'market_driven', 1.0, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        repTitle,
        topic,
        hits.length,
        coverage,
        novelty,
        surprise,
        llm,
        final,
        market.slug,
        now,
        prev,
        log,
        hits.length,
      )
      .first<{ id: number }>();
    if (!ins?.id) return;
    clusterId = ins.id;
  }

  for (const h of hits) {
    await env.DB
      .prepare(`UPDATE articles SET cluster_id = ? WHERE id = ? AND cluster_id <> ?`)
      .bind(clusterId, h.id, clusterId)
      .run();
  }
}

/**
 * Hourly entry: snapshot every watchlist market, prune retention, then run
 * Strategy B over the new vs prior-24h price diff.
 */
export async function runMarketSnapshotsAndStrategyB(env: Env): Promise<{
  snapshotted: number;
  flagged: number;
  marketDriven: number;
}> {
  const slugs = await loadWatchlistSlugs(env);
  if (slugs.length === 0) {
    console.log('snapshots: empty watchlist, skipping');
    return { snapshotted: 0, flagged: 0, marketDriven: 0 };
  }

  let snapshotted = 0;
  let flagged = 0;
  let marketDriven = 0;
  let kimiCalls = 0;

  for (const slug of slugs) {
    let raw;
    try {
      raw = await fetchMarketBySlug(slug);
    } catch (e) {
      console.error('Gamma slug fetch failed', slug, e);
      continue;
    }
    if (!raw) continue;
    const norm = normalizeMarket(raw);
    if (!norm) continue;

    const input = inputFromWatchMarket(norm);
    const prev = await priorPrice(env, slug);
    try {
      await recordSnapshot(env, input);
      if (input.yesPrice != null) snapshotted += 1;
    } catch (e) {
      console.error('snapshot insert failed', slug, e);
    }

    if (prev == null || input.yesPrice == null) continue;
    if (!isFlaggedMove(input.yesPrice, prev)) continue;
    flagged += 1;

    if (kimiCalls >= STRATEGY_B_KIMI_CAP) {
      console.log(`Strategy B Kimi cap reached, deferring slug=${slug}`);
      continue;
    }

    const keywords = keywordsFromTitle(input.title);
    const hits = await searchArticles(env, keywords);
    kimiCalls += 1;
    const explanation = await kimiExplain(env, input, prev, input.yesPrice, hits);
    if (!explanation.summary) continue;
    try {
      await upsertMarketDrivenCluster(env, input, prev, input.yesPrice, hits, explanation);
      marketDriven += 1;
    } catch (e) {
      console.error('market-driven cluster upsert failed', slug, e);
    }
  }

  try {
    await pruneOldSnapshots(env);
  } catch (e) {
    console.error('snapshot prune failed', e);
  }

  return { snapshotted, flagged, marketDriven };
}
