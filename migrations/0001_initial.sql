-- M1 schema; aligns with INITIAL.md with pragmatic SQLite types.

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digest_timestamp TEXT NOT NULL,
  cluster_ids TEXT NOT NULL,
  message_id TEXT,
  channel_kind TEXT NOT NULL DEFAULT 'webhook'
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  representative_title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT 'general',
  source_weight_sum REAL NOT NULL DEFAULT 0,
  novelty_score REAL NOT NULL DEFAULT 0,
  surprise_score REAL NOT NULL DEFAULT 0,
  llm_score REAL NOT NULL DEFAULT 0,
  final_score REAL NOT NULL DEFAULT 0,
  polymarket_slug TEXT,
  flow_type TEXT NOT NULL DEFAULT 'news_driven',
  posted_digest_id INTEGER,
  llm_reasoning_log TEXT,
  FOREIGN KEY (posted_digest_id) REFERENCES posts(id)
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_hash TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  cluster_id INTEGER NOT NULL,
  vec_id TEXT,
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_cluster ON articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched ON articles(fetched_at);
CREATE INDEX IF NOT EXISTS idx_clusters_unposted_score
  ON clusters(final_score DESC)
  WHERE posted_digest_id IS NULL;
