/**
 * Polymarket watchlist: top-50 by 24h volume, deterministic category filter,
 * Kimi disambiguation on ambiguous rows, persisted to D1 + KV + Vectorize.
 *
 * Cadence (M3): refresh once every ~24h, gated on `cursors:watchlist_refreshed_at`.
 */
import type { Env } from './env';
import { runEmbed, runLLM, MODEL_KIMI_JUDGE, textFromChatOut } from './llm';
import {
  fetchActiveMarketsByVolume,
  normalizeMarket,
  type WatchMarket,
} from './polymarket';

const WATCHLIST_TARGET = 50;
const FETCH_OVERSAMPLE = 200;
const WATCHLIST_TTL_SEC = 60 * 60 * 26; // ~26h cushion over the 24h cadence
const WATCHLIST_KV_KEY = 'watchlist:current';
const WATCHLIST_CURSOR_KEY = 'cursors:watchlist_refreshed_at';
const REFRESH_AFTER_HOURS = 23;

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

function classifyByTags(m: WatchMarket): Verdict {
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

/** Kimi binary keep/drop with strict JSON output. Defaults to drop on parse failure. */
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
  if (force) return true;
  const cursor = await env.CONFIG.get(WATCHLIST_CURSOR_KEY);
  if (!cursor) return true;
  const t = Date.parse(cursor);
  if (!Number.isFinite(t)) return true;
  const hours = (Date.now() - t) / 3600000;
  return hours >= REFRESH_AFTER_HOURS;
}

/** Persist watchlist KV blob + cursor + per-market D1 + Vectorize embeddings. */
async function persistWatchlist(env: Env, kept: WatchMarket[]): Promise<void> {
  const nowIso = new Date().toISOString();
  await env.CONFIG.put(WATCHLIST_KV_KEY, JSON.stringify({ at: nowIso, slugs: kept.map((m) => m.slug) }), {
    expirationTtl: WATCHLIST_TTL_SEC,
  });

  if (kept.length === 0) {
    await env.CONFIG.put(WATCHLIST_CURSOR_KEY, nowIso);
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
    const vecId = `m:${m.slug}`;
    await env.DB
      .prepare(
        `INSERT INTO markets (slug, title, description, category, end_date, vec_id,
            yes_token_id, last_seen_in_watchlist, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            category = excluded.category,
            end_date = excluded.end_date,
            vec_id = excluded.vec_id,
            yes_token_id = excluded.yes_token_id,
            last_seen_in_watchlist = excluded.last_seen_in_watchlist,
            last_updated = excluded.last_updated`,
      )
      .bind(
        m.slug,
        m.title,
        m.description,
        m.category,
        m.endDate,
        vecId,
        m.yesTokenId,
        nowIso,
        nowIso,
      )
      .run();

    const vec = vecs[i];
    if (!vec || vec.length === 0) continue;
    try {
      await env.MARKETS.upsert([
        {
          id: vecId,
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

  let raw;
  try {
    raw = await fetchActiveMarketsByVolume(FETCH_OVERSAMPLE);
  } catch (e) {
    console.error('Gamma fetch failed', e);
    return [];
  }

  const norm: WatchMarket[] = [];
  for (const r of raw) {
    const n = normalizeMarket(r);
    if (n) norm.push(n);
  }

  const kept: WatchMarket[] = [];
  let kimiCalls = 0;
  const KIMI_CAP = 30;

  for (const m of norm) {
    if (kept.length >= WATCHLIST_TARGET) break;
    const verdict = classifyByTags(m);
    if (verdict === 'drop') continue;
    if (verdict === 'keep') {
      kept.push(m);
      continue;
    }
    if (kimiCalls >= KIMI_CAP) {
      continue;
    }
    kimiCalls += 1;
    let keep = false;
    try {
      keep = await kimiDisambiguate(env, m);
    } catch (e) {
      console.error('Kimi watchlist disambiguation failed', m.slug, e);
      continue;
    }
    if (keep) kept.push(m);
  }

  await persistWatchlist(env, kept);
  console.log(
    `watchlist refreshed kept=${kept.length} from raw=${raw.length} kimi=${kimiCalls}`,
  );
  return kept.map((m) => m.slug);
}

/** Read the current watchlist slugs from KV (or empty list if not set). */
export async function loadWatchlistSlugs(env: Env): Promise<string[]> {
  const raw = await env.CONFIG.get(WATCHLIST_KV_KEY);
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { slugs?: string[] };
    return Array.isArray(j.slugs) ? j.slugs : [];
  } catch {
    return [];
  }
}
