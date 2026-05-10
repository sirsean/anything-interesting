-- M2: persisted coverage + judgment bookkeeping for Kimi re-run rules.

ALTER TABLE clusters ADD COLUMN coverage_score REAL NOT NULL DEFAULT 0;
ALTER TABLE clusters ADD COLUMN judged_distinct_sources INTEGER NOT NULL DEFAULT 0;
