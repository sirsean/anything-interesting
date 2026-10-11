-- Additive family-news schema. Historical clusters/posts remain readable.
ALTER TABLE articles ADD COLUMN feed_id TEXT;
ALTER TABLE articles ADD COLUMN publisher TEXT;
ALTER TABLE articles ADD COLUMN content_type TEXT NOT NULL DEFAULT 'reporting';
ALTER TABLE articles ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN excerpt TEXT NOT NULL DEFAULT '';
ALTER TABLE articles ADD COLUMN page_fetched_hash TEXT;
ALTER TABLE articles ADD COLUMN content_hash TEXT;
ALTER TABLE articles ADD COLUMN enriched_hash TEXT;
ALTER TABLE articles ADD COLUMN enrichment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN next_enrichment_at TEXT;
ALTER TABLE articles ADD COLUMN updated_at TEXT;
UPDATE articles SET publisher = CASE WHEN source LIKE 'Politico (%)' THEN 'Politico' ELSE source END,
  enriched_hash = 'legacy', enrichment_status = 'ready', updated_at = fetched_at;
ALTER TABLE clusters ADD COLUMN editorial_json TEXT;
ALTER TABLE clusters ADD COLUMN editorial_evidence_json TEXT;
ALTER TABLE clusters ADD COLUMN editorial_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN evidence_hash TEXT;
ALTER TABLE clusters ADD COLUMN event_key TEXT;
ALTER TABLE clusters ADD COLUMN confidence REAL NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN judgment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE clusters ADD COLUMN judgment_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN next_judgment_at TEXT;
ALTER TABLE clusters ADD COLUMN last_analyzed_at TEXT;
ALTER TABLE clusters ADD COLUMN last_development_at TEXT;
ALTER TABLE clusters ADD COLUMN last_delivered_version INTEGER NOT NULL DEFAULT 0;
UPDATE clusters SET last_development_at = last_updated;
CREATE INDEX idx_articles_enrichment ON articles(enrichment_status, next_enrichment_at, updated_at);
CREATE INDEX idx_clusters_editorial ON clusters(judgment_status, next_judgment_at, last_development_at);
CREATE TABLE source_health (
  feed_id TEXT PRIMARY KEY, label TEXT NOT NULL, publisher TEXT NOT NULL, topic TEXT NOT NULL,
  checked_at TEXT NOT NULL, last_success_at TEXT, newest_published_at TEXT,
  item_count INTEGER NOT NULL DEFAULT 0, new_items INTEGER NOT NULL DEFAULT 0,
  expected_interval_hours INTEGER NOT NULL DEFAULT 48, error TEXT
);
CREATE TABLE llm_usage (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved', tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_llm_usage_day ON llm_usage(day, task);
CREATE TABLE editions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL UNIQUE, timezone TEXT NOT NULL,
  created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'prepared', health_json TEXT NOT NULL,
  selection_reason TEXT NOT NULL DEFAULT '', post_id INTEGER REFERENCES posts(id)
);
CREATE TABLE edition_items (
  edition_id INTEGER NOT NULL REFERENCES editions(id), position INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id), story_version INTEGER NOT NULL,
  event_key TEXT NOT NULL, brief_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, attempted_at TEXT,
  error TEXT, PRIMARY KEY(edition_id, position), UNIQUE(edition_id, cluster_id)
);
CREATE INDEX idx_edition_items_story ON edition_items(cluster_id, story_version);
CREATE INDEX idx_edition_items_event ON edition_items(event_key, edition_id);
CREATE TABLE pipeline_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE job_leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE interest_votes (
  message_id TEXT NOT NULL, user_id TEXT NOT NULL, direction TEXT NOT NULL,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id), topic TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(message_id, user_id, direction)
);
CREATE INDEX idx_interest_votes_topic ON interest_votes(topic, created_at);
