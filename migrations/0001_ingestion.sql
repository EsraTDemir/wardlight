PRAGMA foreign_keys = ON;

CREATE TABLE ingestion_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  run_id TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  workflow_run_id TEXT NOT NULL,
  workflow_run_attempt INTEGER NOT NULL,
  collector_version TEXT NOT NULL,
  accepted_count INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX ingestion_events_source_run_idx
  ON ingestion_events (source, run_id);

CREATE TABLE postings (
  source TEXT NOT NULL,
  source_posting_key TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  times_seen INTEGER NOT NULL,
  external_ids_json TEXT NOT NULL,
  claimed_posted_dates_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  description_hashes_json TEXT NOT NULL,
  last_salary TEXT,
  description_length INTEGER NOT NULL,
  canonical_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, source_posting_key)
);

CREATE INDEX postings_company_title_idx
  ON postings (company, title);
CREATE INDEX postings_last_seen_idx
  ON postings (last_seen_at);

CREATE TABLE posting_score_snapshots (
  source TEXT NOT NULL,
  source_posting_key TEXT NOT NULL,
  scored_at TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  verdict TEXT NOT NULL CHECK (verdict IN ('active', 'watch', 'likely_ghost', 'ghost')),
  tags_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, source_posting_key, scored_at),
  FOREIGN KEY (source, source_posting_key)
    REFERENCES postings (source, source_posting_key),
  FOREIGN KEY (event_id) REFERENCES ingestion_events (event_id)
);

CREATE INDEX posting_score_snapshots_verdict_date_idx
  ON posting_score_snapshots (verdict, scored_at);
