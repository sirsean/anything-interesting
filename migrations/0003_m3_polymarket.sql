-- M3: Polymarket integration. Watchlist + snapshots + market-driven cluster metadata.

CREATE TABLE IF NOT EXISTS markets (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  end_date TEXT,
  vec_id TEXT,
  yes_token_id TEXT,
  last_seen_in_watchlist TEXT NOT NULL DEFAULT (datetime('now')),
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_markets_last_seen ON markets(last_seen_in_watchlist DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_slug TEXT NOT NULL,
  price REAL NOT NULL,
  volume_24h REAL,
  taken_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (market_slug) REFERENCES markets(slug)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_slug_taken
  ON market_snapshots(market_slug, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_taken
  ON market_snapshots(taken_at);

-- Cluster bookkeeping for Polymarket match (Strategy A) + similarity score.
-- `polymarket_slug` and `flow_type` already exist from M1.
ALTER TABLE clusters ADD COLUMN polymarket_match_score REAL NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN polymarket_price REAL;
ALTER TABLE clusters ADD COLUMN polymarket_price_24h_ago REAL;
