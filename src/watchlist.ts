/**
 * Polymarket watchlist: breaking movers + volume backfill, category filter,
 * Kimi disambiguation on ambiguous rows, persisted to D1 + KV + Vectorize.
 *
 * Reliability: CONFIG `watchlist:current` can expire while `cursors:watchlist_refreshed_at`
 * still blocks refresh for 23h — leaving hourly snapshots with no slugs. We re-refresh when
 * KV is missing/empty and fall back to recent D1 rows for snapshot + API reads.
 */
import type { Env } from './env';
import { loadWatchlistSlugsFromD1, upsertMarketRow } from './market_store';
import { runEmbed, runLLM, MODEL_KIMI_JUDGE, textFromChatOut } from './llm';
import {
  fetchActiveMarketsByVolume,
  fetchBreakingMarkets,
  normalizeMarket,
  type GammaMarket,
  type WatchMarket,
} from './polymarket';

export const WATCHLIST_TARGET = 150;
const FETCH_OVERSAMPLE = 500;
/** Long TTL — cursor gates refresh cadence; short KV TTL caused snapshot outages. */
const WATCHLIST_KV_TTL_SEC = 60 * 60 * 24 * 7;
export const WATCHLIST_KV_KEY = 'watchlist:current';
export const WATCHLIST_CURSOR_KEY = 'cursors:watchlist_refreshed_at';
export const REFRESH_AFTER_HOURS = 23;

/** Tag/category substrings that must always be dropped (deterministic filter). */
const BLOCK_TAGS = [
  'sports',
  'sport',
  'nfl',
  'nba',
  'mlb',
  'nhl',
  'soccer',
  'football',
  'basketball',
  'baseball',
  'hockey',
  'tennis',
  'golf',
  'mma',
  'ufc',
  'boxing',
  'cricket',
  'olympics',
  'pop-culture',
  'pop_culture',
  'pop culture',
  'entertainment',
  'celebrity',
  'celebrities',
  'movies',
  'film',
  'tv',
  'television',
  'music',
  'gaming',
  'video games',
  'games',
];

/** Tag/category substrings that always pass the filter (no Kimi call needed). */
const KEEP_TAGS = [
  'elections',
  'election',
  'politics',
  'geopolitics',
  'world',
  'foreign policy',
  'economics',
  'economy',
  'macro',
  'finance',
  'crypto',
  'policy',
  'regulation',
  'tech',
  'technology',
  'ai',
  'science',
  'climate',
  'energy',
  'health',
];

type Verdict = 'keep' | 'drop' | 'ambiguous';

export function parseWatchlistKv(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { slugs?: string[] };
    return Array.isArray(j.slugs) ? j.slugs.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Pure helper for refresh gating tests. */
export function needsWatchlistRefresh(opts: {
  force: boolean;
  cursorIso: string | null;
  kvSlugs: string[];
  nowMs: number;
}): boolean {
  if (opts.force) return true;
  if (opts.kvSlugs.length === 0) return true;
  if (!opts.cursorIso) return true;
  const t = Date.parse(opts.cursorIso);
  if (!Number.isFinite(t)) return true;
  const hours = (opts.nowMs - t) / 3600000;
  return hours >= REFRESH_AFTER_HOURS;
}

function classifyByTags(m: WatchMarket): Verdict {
  const slug = m.slug.toLowerCase();
  for (const blk of BLOCK_TAGS) {
    if (slug.includes(blk)) return 'drop';
  }
  const haystacks = [m.category.toLowerCase(), ...m.tagLabels];
  for (const t of haystacks) {
    if (!t) continue;
    for (const blk of BLOCK_TAGS) {
      if (t === blk || t.includes(blk)) return 'drop';
    }
  }
  for (const t of haystacks) {
    if (!t) continue;
    for (const kp of KEEP_TAGS) {
      if (t === kp || t.includes(kp)) return 'keep';
    }
  }
  return 'ambiguous';
}

async function kimiDisambiguate(env: Env, m: WatchMarket): Promise<boolean> {
  const raw = await runLLM(
    env,
    'watchlist_filter',
    MODEL_KIMI_JUDGE,
    [
      {
        role: 'system',
        content:
          'You decide if a Polymarket prediction market belongs in a precision-first geopolitics/politics/economics/policy/tech/science news-alert watchlist. Drop sports, pop culture, entertainment, gaming. Reply JSON only: {"keep":true} or {"keep":false}.',
      },
      {
        role: 'user',
        content: `Title: ${m.title}\nCategory: ${m.category || '(none)'}\nTags: ${m.tagLabels.join(', ') || '(none)'}\nDescription: ${m.description.slice(0, 600)}`,
      },
    ],
    { max_tokens: 64, temperature: 0, response_format: { type: 'json_object' } },
  );
  const txt = textFromChatOut(raw);
  const m2 = txt.match(/\{[\s\S]*\}/);
  if (!m2) return false;
  try {
    const j = JSON.parse(m2[0]) as { keep?: boolean };
    return j.keep === true;
  } catch {
    return false;
  }
}

async function shouldRefresh(env: Env, force: boolean): Promise<boolean> {
  const kvSlugs = parseWatchlistKv(await env.CONFIG.get(WATCHLIST_KV_KEY));
  const cursor = await env.CONFIG.get(WATCHLIST_CURSOR_KEY);
  return needsWatchlistRefresh({ force, cursorIso: cursor, kvSlugs, nowMs: Date.now() });
}

async function persistWatchlist(env: Env, kept: WatchMarket[]): Promise<void> {
  const nowIso = new Date().toISOString();
  await env.CONFIG.put(
    WATCHLIST_KV_KEY,
    JSON.stringify({ at: nowIso, slugs: kept.map((m) => m.slug) }),
    { expirationTtl: WATCHLIST_KV_TTL_SEC },
  );

  if (kept.length === 0) {
    await env.CONFIG.put(WATCHLIST_CURSOR_KEY, nowIso);
    console.warn(`persistWatchlist empty kept=0 cursor=${nowIso}`);
    return;
  }

  const embedTexts = kept.map((m) => `${m.title}\n${m.description.slice(0, 400)}`.trim());
  let vecs: number[][] = [];
  try {
    vecs = await runEmbed(env, embedTexts);
  } catch (e) {
    console.error('watchlist embed failed', e);
  }

  for (let i = 0; i < kept.length; i++) {
    const m = kept[i];
    await upsertMarketRow(env, m);

    const vec = vecs[i];
    if (!vec || vec.length === 0) continue;
    try {
      await env.MARKETS.upsert([
        {
          id: `m:${m.slug}`,
          values: vec,
          metadata: {
            slug: m.slug,
            title: m.title.slice(0, 400),
          },
        },
      ]);
    } catch (e) {
      console.error('markets vectorize upsert failed', m.slug, e);
    }
  }

  await env.CONFIG.put(WATCHLIST_CURSOR_KEY, nowIso);
}

/**
 * Main entry: refresh watchlist if stale. Returns the list of slugs persisted.
 */
export async function refreshWatchlistIfDue(env: Env, opts?: { force?: boolean }): Promise<string[]> {
  if (!(await shouldRefresh(env, opts?.force === true))) {
    return [];
  }

  let breakingRaw: Awaited<ReturnType<typeof fetchBreakingMarkets>> = [];
  try {
    breakingRaw = await fetchBreakingMarkets();
  } catch (e) {
    console.error('breaking biggest-movers fetch failed', e);
  }

  const kept: WatchMarket[] = [];
  const seenSlugs = new Set<string>();
  let breakingNorm = 0;

  for (const r of breakingRaw) {
    const n = normalizeMarket(r);
    if (!n || seenSlugs.has(n.slug)) continue;
    breakingNorm += 1;
    if (classifyByTags(n) === 'drop') continue;
    seenSlugs.add(n.slug);
    kept.push(n);
  }

  let volumeRaw = 0;
  let volumeNorm = 0;
  let kimiCalls = 0;
  const KIMI_CAP = 40;

  if (kept.length < WATCHLIST_TARGET) {
    let raw: GammaMarket[] = [];
    try {
      raw = await fetchActiveMarketsByVolume(FETCH_OVERSAMPLE);
      volumeRaw = raw.length;
    } catch (e) {
      console.error('Gamma volume fetch failed', e);
      raw = [];
    }

    for (const r of raw) {
      if (kept.length >= WATCHLIST_TARGET) break;
      const n = normalizeMarket(r);
      if (!n || seenSlugs.has(n.slug)) continue;
      volumeNorm += 1;
      const verdict = classifyByTags(n);
      if (verdict === 'drop') continue;
      if (verdict === 'keep') {
        seenSlugs.add(n.slug);
        kept.push(n);
        continue;
      }
      if (kimiCalls >= KIMI_CAP) continue;
      kimiCalls += 1;
      let keep = false;
      try {
        keep = await kimiDisambiguate(env, n);
      } catch (e) {
        console.error('Kimi watchlist disambiguation failed', n.slug, e);
        continue;
      }
      if (keep) {
        seenSlugs.add(n.slug);
        kept.push(n);
      }
    }
  }

  await persistWatchlist(env, kept);
  console.log(
    `watchlist refreshed kept=${kept.length} breaking=${breakingNorm} volume_raw=${volumeRaw} volume_norm=${volumeNorm} kimi=${kimiCalls}`,
  );
  return kept.map((m) => m.slug);
}

/**
 * Current watchlist slugs: CONFIG KV first, then repair from D1 when KV is missing.
 */
export async function loadWatchlistSlugs(env: Env): Promise<string[]> {
  const fromKv = parseWatchlistKv(await env.CONFIG.get(WATCHLIST_KV_KEY));
  if (fromKv.length > 0) return fromKv;

  const fromD1 = await loadWatchlistSlugsFromD1(env.DB, WATCHLIST_TARGET);
  if (fromD1.length > 0) {
    await env.CONFIG.put(
      WATCHLIST_KV_KEY,
      JSON.stringify({ at: new Date().toISOString(), slugs: fromD1, repaired_from_d1: true }),
      { expirationTtl: WATCHLIST_KV_TTL_SEC },
    );
    console.log(`watchlist KV repaired from D1 count=${fromD1.length}`);
  }
  return fromD1;
}
