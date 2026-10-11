-- Bounded, cached thin-evidence research; stored separately from feed articles.
CREATE TABLE news_research_requests (
  id TEXT PRIMARY KEY, cluster_id INTEGER NOT NULL REFERENCES clusters(id),
  day TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reserved',
  evidence_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_news_research_day ON news_research_requests(day);

-- Old digests cannot be replayed as a new first editorial version.
UPDATE clusters SET last_delivered_version = 1 WHERE posted_digest_id IS NOT NULL AND editorial_version = 0;
