-- Strategy B (market-driven) clusters should CITE supporting articles without
-- stealing them from their real news clusters. This reference table replaces the
-- previous `UPDATE articles SET cluster_id = <market cluster>` behavior, which
-- corrupted news clusters and dragged unrelated headlines into market digests.

CREATE TABLE IF NOT EXISTS market_cluster_articles (
  cluster_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cluster_id, article_id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(id),
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE INDEX IF NOT EXISTS idx_market_cluster_articles_cluster
  ON market_cluster_articles (cluster_id);
