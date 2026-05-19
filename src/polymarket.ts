/**
 * Polymarket Gamma (markets metadata) + CLOB (prices) clients.
 *
 * Verified 2026-05 against `docs.polymarket.com`. Field names below match the
 * Gamma OpenAPI exactly — keep them in sync if Polymarket revs the API.
 */

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const POLYMARKET_SITE = 'https://polymarket.com';
const CLOB_BASE = 'https://clob.polymarket.com';

/** Categories on /breaking/{category} (same as `biggest-movers` query param). */
export const BREAKING_CATEGORIES = ['politics', 'world'] as const;
export type BreakingCategory = (typeof BREAKING_CATEGORIES)[number];

/** Row shape from `GET /api/biggest-movers?category=…` (Polymarket web app). */
export type BiggestMoverMarket = {
  id: string;
  slug: string;
  question?: string | null;
  outcomePrices?: string[] | null;
  clobTokenIds?: string[] | null;
  oneDayPriceChange?: number | null;
  currentPrice?: number | null;
  closed?: boolean | null;
  events?: { volume?: number | null }[] | null;
};

const UA =
  'Mozilla/5.0 (compatible; anything-interesting/1.0; +https://developers.cloudflare.com/workers/)';

/** Subset of Gamma `/markets` Market we actually consume. Many fields are optional. */
export type GammaMarket = {
  id: string;
  slug: string;
  question?: string | null;
  description?: string | null;
  category?: string | null;
  endDate?: string | null;
  endDateIso?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  archived?: boolean | null;
  /** JSON-encoded string array, e.g. '["Yes","No"]' */
  outcomes?: string | null;
  /** JSON-encoded string array of price strings, e.g. '["0.34","0.66"]' */
  outcomePrices?: string | null;
  /** JSON-encoded string array of CLOB token ids matching outcomes order. */
  clobTokenIds?: string | null;
  volume24hr?: number | null;
  volumeNum?: number | null;
  lastTradePrice?: number | null;
  oneDayPriceChange?: number | null;
  oneHourPriceChange?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  tags?: { id?: string; label?: string | null; slug?: string | null }[] | null;
};

export type WatchMarket = {
  slug: string;
  title: string;
  description: string;
  category: string;
  endDate: string | null;
  yesTokenId: string | null;
  /** Best-effort current YES probability in [0,1]. */
  yesPrice: number | null;
  /** Reported absolute change over the last 24h (Gamma `oneDayPriceChange`). */
  oneDayPriceChange: number | null;
  volume24h: number | null;
  tagLabels: string[];
};

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function pickYesIndex(outcomes: string[] | null): number {
  if (!outcomes || outcomes.length === 0) return 0;
  const idx = outcomes.findIndex((o) => o.trim().toLowerCase() === 'yes');
  return idx >= 0 ? idx : 0;
}

/** Convert raw Gamma row to the trimmed shape we persist + reason about. */
export function normalizeMarket(m: GammaMarket): WatchMarket | null {
  if (!m.slug) return null;
  if (m.closed === true || m.archived === true) return null;
  const title = (m.question ?? '').trim();
  if (!title) return null;

  const outcomes = safeJson<string[]>(m.outcomes);
  const prices = safeJson<string[]>(m.outcomePrices);
  const tokens = safeJson<string[]>(m.clobTokenIds);
  const yesIdx = pickYesIndex(outcomes);

  const yesTokenId = tokens && tokens[yesIdx] ? tokens[yesIdx] : null;
  let yesPrice: number | null = null;
  if (typeof m.lastTradePrice === 'number' && Number.isFinite(m.lastTradePrice)) {
    yesPrice = m.lastTradePrice;
  } else if (prices && prices[yesIdx] != null) {
    const p = parseFloat(prices[yesIdx]);
    if (Number.isFinite(p)) yesPrice = p;
  }
  if (yesPrice != null) {
    yesPrice = Math.max(0, Math.min(1, yesPrice));
  }

  const tagLabels = (m.tags ?? [])
    .map((t) => (t?.label ?? t?.slug ?? '').toString().trim().toLowerCase())
    .filter((s) => s.length > 0);

  return {
    slug: m.slug,
    title: title.slice(0, 500),
    description: (m.description ?? '').toString().slice(0, 2000),
    category: (m.category ?? '').toString().slice(0, 100),
    endDate: m.endDateIso ?? m.endDate ?? null,
    yesTokenId,
    yesPrice,
    oneDayPriceChange:
      typeof m.oneDayPriceChange === 'number' && Number.isFinite(m.oneDayPriceChange)
        ? m.oneDayPriceChange
        : null,
    volume24h:
      typeof m.volume24hr === 'number' && Number.isFinite(m.volume24hr) ? m.volume24hr : null,
    tagLabels,
  };
}

/** Map a breaking-page market into Gamma shape for `normalizeMarket`. */
export function biggestMoverToGamma(m: BiggestMoverMarket, category: BreakingCategory): GammaMarket {
  const vol = m.events?.[0]?.volume;
  return {
    id: m.id,
    slug: m.slug,
    question: m.question,
    description: null,
    category,
    active: m.closed !== true,
    closed: m.closed ?? false,
    archived: false,
    outcomes: '["Yes","No"]',
    outcomePrices: m.outcomePrices?.length ? JSON.stringify(m.outcomePrices) : null,
    clobTokenIds: m.clobTokenIds?.length ? JSON.stringify(m.clobTokenIds) : null,
    lastTradePrice: m.currentPrice ?? null,
    oneDayPriceChange: m.oneDayPriceChange ?? null,
    volume24hr: typeof vol === 'number' && Number.isFinite(vol) ? vol : null,
    tags: [{ label: category, slug: category }],
  };
}

/**
 * Markets featured on /breaking/{category} — 24h “biggest movers” curated by Polymarket.
 * @see https://polymarket.com/breaking/politics (dehydrates queryKey `['biggest-movers', category]`)
 */
export async function fetchBiggestMoversByCategory(
  category: BreakingCategory,
): Promise<BiggestMoverMarket[]> {
  const url = new URL(`${POLYMARKET_SITE}/api/biggest-movers`);
  url.searchParams.set('category', category);
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`biggest-movers category=${category} failed: ${res.status} ${res.statusText}`);
    return [];
  }
  const body = (await res.json()) as { markets?: BiggestMoverMarket[] } | null;
  if (!body || !Array.isArray(body.markets)) {
    console.error(`biggest-movers category=${category} unexpected shape`, body);
    return [];
  }
  return body.markets.filter((m) => m?.slug);
}

/** Merge breaking feeds (dedupe by slug). */
export async function fetchBreakingMarkets(
  categories: readonly BreakingCategory[] = BREAKING_CATEGORIES,
): Promise<GammaMarket[]> {
  const out: GammaMarket[] = [];
  const seen = new Set<string>();
  for (const category of categories) {
    const rows = await fetchBiggestMoversByCategory(category);
    for (const row of rows) {
      if (seen.has(row.slug)) continue;
      seen.add(row.slug);
      out.push(biggestMoverToGamma(row, category));
    }
  }
  return out;
}

/**
 * Fetch active markets sorted by 24h volume. Polymarket sometimes returns the
 * sort field unset on individual rows, so we re-sort client-side as a safety net.
 */
export async function fetchActiveMarketsByVolume(limit: number): Promise<GammaMarket[]> {
  const url = new URL(`${GAMMA_BASE}/markets`);
  url.searchParams.set('order', 'volume24hr');
  url.searchParams.set('ascending', 'false');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('active', 'true');
  url.searchParams.set('limit', String(Math.max(1, Math.min(500, limit))));

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`Gamma /markets failed: ${res.status} ${res.statusText}`);
    return [];
  }
  const body = (await res.json()) as GammaMarket[] | { error?: string } | null;
  if (!Array.isArray(body)) {
    console.error('Gamma /markets unexpected shape', body);
    return [];
  }
  return body
    .filter((m) => m && (m.closed !== true) && (m.archived !== true))
    .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0));
}

/** Fetch a single market by slug (used for refresh / on-demand lookups). */
export async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const url = `${GAMMA_BASE}/markets?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`Gamma /markets?slug failed ${slug}: ${res.status}`);
    return null;
  }
  const body = (await res.json()) as GammaMarket[] | null;
  if (!Array.isArray(body) || body.length === 0) return null;
  return body[0];
}

type ClobHistoryResp = { history?: { t: number; p: number }[] };

/**
 * Pull CLOB price history. We use this as a fallback for the 24h-ago price
 * when Gamma `oneDayPriceChange` is missing.
 */
export async function fetchPriceHistory(
  tokenId: string,
  windowHours: number,
): Promise<{ t: number; p: number }[]> {
  const url = new URL(`${CLOB_BASE}/prices-history`);
  url.searchParams.set('market', tokenId);
  const now = Math.floor(Date.now() / 1000);
  url.searchParams.set('startTs', String(now - windowHours * 3600));
  url.searchParams.set('endTs', String(now));
  url.searchParams.set('fidelity', '60');
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`CLOB /prices-history failed ${tokenId}: ${res.status}`);
    return [];
  }
  const body = (await res.json()) as ClobHistoryResp;
  return Array.isArray(body.history) ? body.history : [];
}

/**
 * Best-effort 24h-ago YES probability for a market.
 * Prefers Gamma's `oneDayPriceChange` math; falls back to CLOB history.
 */
export async function priceTwentyFourHoursAgo(
  market: WatchMarket,
): Promise<number | null> {
  if (
    market.yesPrice != null &&
    market.oneDayPriceChange != null &&
    Number.isFinite(market.oneDayPriceChange)
  ) {
    const prev = market.yesPrice - market.oneDayPriceChange;
    return Math.max(0, Math.min(1, prev));
  }
  if (!market.yesTokenId) return null;
  const hist = await fetchPriceHistory(market.yesTokenId, 26);
  if (hist.length === 0) return null;
  const sorted = hist.slice().sort((a, b) => a.t - b.t);
  return sorted[0].p;
}
