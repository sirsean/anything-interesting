-- M5: Discord reaction → feedback, dynamic source_weights, per-cluster digest messages.

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  cluster_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (message_id, user_id, reaction),
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_cluster ON feedback(cluster_id);
CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts DESC);

CREATE TABLE IF NOT EXISTS source_weights (
  source TEXT PRIMARY KEY,
  weight REAL NOT NULL DEFAULT 1.0,
  pos_count INTEGER NOT NULL DEFAULT 0,
  neg_count INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_cluster_messages (
  post_id INTEGER NOT NULL,
  cluster_id INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (post_id, cluster_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
);

CREATE INDEX IF NOT EXISTS idx_post_cluster_messages_message
  ON post_cluster_messages(message_id);
