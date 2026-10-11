-- Wipe local D1 content (keeps schema). Safe order for FKs; foreign_keys off for SQLite.
PRAGMA foreign_keys = OFF;
DELETE FROM news_research_requests;
DELETE FROM interest_votes;
DELETE FROM edition_items;
DELETE FROM editions;
DELETE FROM llm_usage;
DELETE FROM source_health;
DELETE FROM pipeline_runs;
DELETE FROM job_leases;
DELETE FROM feedback;
DELETE FROM post_cluster_messages;
DELETE FROM articles;
DELETE FROM market_snapshots;
DELETE FROM clusters;
DELETE FROM posts;
DELETE FROM markets;
DELETE FROM source_weights;
PRAGMA foreign_keys = ON;
