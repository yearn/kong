-- Standalone schema for the Neon REST cache. Apply explicitly; this is not part
-- of the application's existing database migration chain.
CREATE SCHEMA IF NOT EXISTS neon_rest_cache;

CREATE TABLE IF NOT EXISTS neon_rest_cache.jobs (
  job text PRIMARY KEY,
  published_generation text,
  previous_generation text,
  next_fence bigint NOT NULL DEFAULT 0,
  lease_generation text,
  lease_invocation_id text,
  lease_scheduled_at timestamptz,
  lease_until timestamptz,
  last_success_at timestamptz,
  last_success_scheduled_at timestamptz,
  CHECK ((lease_generation IS NULL) = (lease_until IS NULL)),
  CHECK ((lease_generation IS NULL) = (lease_invocation_id IS NULL))
);

CREATE TABLE IF NOT EXISTS neon_rest_cache.entries (
  job text NOT NULL REFERENCES neon_rest_cache.jobs(job) ON DELETE CASCADE,
  generation text NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (job, generation, key)
);

CREATE TABLE IF NOT EXISTS neon_rest_cache.runs (
  job text NOT NULL REFERENCES neon_rest_cache.jobs(job) ON DELETE CASCADE,
  invocation_id text NOT NULL,
  scheduled_at timestamptz,
  generation text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed', 'stale')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (job, invocation_id)
);

CREATE INDEX IF NOT EXISTS neon_rest_cache_runs_job_started_idx
  ON neon_rest_cache.runs (job, started_at DESC);

