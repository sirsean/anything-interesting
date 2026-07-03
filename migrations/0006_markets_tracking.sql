-- Polymarket watchlist tracking: live quotes on `markets` for API + UI.

ALTER TABLE markets ADD COLUMN yes_price REAL;
ALTER TABLE markets ADD COLUMN volume_24h REAL;
ALTER TABLE markets ADD COLUMN one_day_price_change REAL;
ALTER TABLE markets ADD COLUMN last_snapshot_at TEXT;
