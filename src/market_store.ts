import type { WatchMarket } from './polymarket';

/** Active watchlist rows in D1 (fallback when CONFIG KV is missing or expired). */
export const WATCHLIST_D1_LOOKBACK_HOURS = 72;

export type MarketQuotePatch = {
  yesPrice: number | null;
  volume24h: number | null;
  oneDayPriceChange: number | null;
  touchSnapshot?: boolean;
};

export async function upsertMarketRow(env: { DB: D1Database }, m: WatchMarket): Promise<void> {
  const vecId = `m:${m.slug}`;
  const nowIso = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO markets (slug, title, description, category, end_date, vec_id,
          yes_token_id, yes_price, volume_24h, one_day_price_change,
          last_seen_in_watchlist, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          category = excluded.category,
          end_date = excluded.end_date,
          vec_id = excluded.vec_id,
          yes_token_id = excluded.yes_token_id,
          yes_price = COALESCE(excluded.yes_price, markets.yes_price),
          volume_24h = COALESCE(excluded.volume_24h, markets.volume_24h),
          one_day_price_change = COALESCE(excluded.one_day_price_change, markets.one_day_price_change),
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
      m.yesPrice,
      m.volume24h,
      m.oneDayPriceChange,
      nowIso,
      nowIso,
    )
    .run();
}

export async function patchMarketQuotes(
  db: D1Database,
  slug: string,
  patch: MarketQuotePatch,
): Promise<void> {
  if (patch.touchSnapshot) {
    await db
      .prepare(
        `UPDATE markets
         SET yes_price = COALESCE(?, yes_price),
             volume_24h = COALESCE(?, volume_24h),
             one_day_price_change = COALESCE(?, one_day_price_change),
             last_snapshot_at = datetime('now'),
             last_updated = datetime('now')
         WHERE slug = ?`,
      )
      .bind(patch.yesPrice, patch.volume24h, patch.oneDayPriceChange, slug)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE markets
       SET yes_price = COALESCE(?, yes_price),
           volume_24h = COALESCE(?, volume_24h),
           one_day_price_change = COALESCE(?, one_day_price_change),
           last_updated = datetime('now')
       WHERE slug = ?`,
    )
    .bind(patch.yesPrice, patch.volume24h, patch.oneDayPriceChange, slug)
    .run();
}

export async function loadWatchlistSlugsFromD1(
  db: D1Database,
  limit = 200,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT slug FROM markets
       WHERE datetime(last_seen_in_watchlist) >= datetime('now', ?)
       ORDER BY COALESCE(volume_24h, 0) DESC, last_seen_in_watchlist DESC
       LIMIT ?`,
    )
    .bind(`-${WATCHLIST_D1_LOOKBACK_HOURS} hours`, limit)
    .all<{ slug: string }>();
  return (results ?? []).map((r) => r.slug);
}
