-- M4: speed up `/topnews` listing (last_updated window + score ordering).

CREATE INDEX IF NOT EXISTS idx_clusters_topnews_recent
ON clusters (last_updated DESC, final_score DESC);
