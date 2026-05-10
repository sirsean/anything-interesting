/**
 * Strategy A: news → markets. Given a candidate cluster, find the closest
 * Polymarket markets via the `markets` Vectorize index, optionally Kimi-rerank
 * the top hits, and return a per-cluster Polymarket signal:
 *
 *   - matched market slug (or null)
 *   - similarity score (top vector cosine)
 *   - surprise_score in [0,1] derived from `|price_now - price_24h_ago|`,
 *     scaled with a near-50% prior bonus (per `INITIAL.md`).
 *
 * The pricing snapshot read is local-only — `snapshots.ts` is responsible for
 * keeping `market_snapshots` fresh hourly. We never hit Polymarket from here.
 */
import type { Env } from './env';
import { MODEL_KIMI_JUDGE, runEmbed, runLLM, textFromChatOut } from './llm';

const MATCH_THRESHOLD = 0.7;
const VECTOR_TOPK = 10;

export type MarketMatch = {
  slug: string;
  title: string;
  similarity: number;
  priceNow: number | null;
  price24hAgo: number | null;
  surprise: number;
};

type CandidateMatch = {
  slug: string;
  title: string;
  similarity: number;
};

async function readLatestPrice(env: Env, slug: string): Promise<number | null> {
  const row = await env.DB
    .prepare(
      `SELECT price FROM market_snapshots WHERE market_slug = ?
       ORDER BY taken_at DESC LIMIT 1`,
    )
    .bind(slug)
    .first<{ price: number }>();
  return row?.price ?? null;
}

async function readPrice24hAgo(env: Env, slug: string): Promise<number | null> {
  const row = await env.DB
    .prepare(
      `SELECT price FROM market_snapshots WHERE market_slug = ?
         AND datetime(taken_at) BETWEEN datetime('now', '-26 hours')
                                   AND datetime('now', '-22 hours')
       ORDER BY ABS(strftime('%s', taken_at) - strftime('%s','now','-24 hours')) ASC
       LIMIT 1`,
    )
    .bind(slug)
    .first<{ price: number }>();
  return row?.price ?? null;
}

/** Per `INITIAL.md`: scaled |Δprice| with a bonus when prior was near 50%. */
function surpriseScore(now: number, prev: number): number {
  const abs = Math.abs(now - prev);
  let s = Math.min(1, abs / 0.15);
  const nearFifty = Math.max(0, 1 - Math.abs(0.5 - prev) / 0.5);
  s = Math.min(1, s + 0.25 * nearFifty * Math.min(1, abs / 0.05));
  return s;
}

/** Kimi rerank top-K candidates → return slugs that genuinely match the story. */
async function kimiRerank(
  env: Env,
  storyTitle: string,
  candidates: CandidateMatch[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const numbered = candidates
    .map((c, i) => `${i + 1}. [${c.slug}] ${c.title.slice(0, 220)}`)
    .join('\n');
  let raw: unknown;
  try {
    raw = await runLLM(
      env,
      'market_match',
      MODEL_KIMI_JUDGE,
      [
        {
          role: 'system',
          content:
            'You decide which Polymarket markets are genuinely about the same news story (causal/topical match, not just keyword overlap). Pick at most 2. Reply JSON only: {"slugs":["..."]}.',
        },
        {
          role: 'user',
          content: `News story: ${storyTitle.slice(0, 400)}\n\nCandidate markets:\n${numbered}`,
        },
      ],
      { max_tokens: 200, temperature: 0, response_format: { type: 'json_object' } },
    );
  } catch (e) {
    console.error('Kimi market_match failed', e);
    return new Set();
  }
  const txt = textFromChatOut(raw);
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return new Set();
  try {
    const j = JSON.parse(m[0]) as { slugs?: string[] };
    return new Set((j.slugs ?? []).filter((s): s is string => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * Returns the best-matching Polymarket market for a story (or null) plus a
 * surprise score derived from snapshot history.
 */
export async function matchClusterToMarkets(
  env: Env,
  storyTitle: string,
  storySummary: string,
): Promise<MarketMatch | null> {
  const text = `${storyTitle.slice(0, 400)}\n${storySummary.slice(0, 400)}`.trim();
  if (!text) return null;

  let vec: number[];
  try {
    const out = await runEmbed(env, [text]);
    vec = out[0] ?? [];
  } catch (e) {
    console.error('Strategy A embed failed', e);
    return null;
  }
  if (vec.length === 0) return null;

  let matches;
  try {
    matches = await env.MARKETS.query(vec, { topK: VECTOR_TOPK, returnMetadata: true });
  } catch (e) {
    console.error('markets vectorize query failed', e);
    return null;
  }

  const candidates: CandidateMatch[] = [];
  for (const m of matches.matches ?? []) {
    if (typeof m.score !== 'number') continue;
    const slug = m.metadata?.slug;
    const title = m.metadata?.title;
    if (typeof slug !== 'string') continue;
    candidates.push({
      slug,
      title: typeof title === 'string' ? title : slug,
      similarity: m.score,
    });
  }

  if (candidates.length === 0) return null;
  const top = candidates[0];
  if (top.similarity < MATCH_THRESHOLD) return null;

  const keepSlugs = await kimiRerank(env, storyTitle, candidates.slice(0, 5));
  const winner = keepSlugs.size > 0
    ? candidates.find((c) => keepSlugs.has(c.slug)) ?? top
    : top;

  const priceNow = await readLatestPrice(env, winner.slug);
  const price24h = await readPrice24hAgo(env, winner.slug);
  const surprise =
    priceNow != null && price24h != null ? surpriseScore(priceNow, price24h) : 0;

  return {
    slug: winner.slug,
    title: winner.title,
    similarity: winner.similarity,
    priceNow,
    price24hAgo: price24h,
    surprise,
  };
}
