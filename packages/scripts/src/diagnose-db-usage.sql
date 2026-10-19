-- Run separately on the primary and each active read replica. Save two samples
-- to compare deltas by (role, queryid); do not reset production statistics.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT now() AS sampled_at, current_database() AS database,
       pg_postmaster_start_time() AS compute_started_at, stats_reset
FROM pg_stat_statements_info;

SELECT r.rolname AS role, s.queryid::text, s.calls, s.rows AS rows_returned,
       round(s.rows::numeric / nullif(s.calls, 0), 1) AS rows_per_call,
       round(s.total_exec_time::numeric / 1000, 1) AS execution_seconds,
       round(s.mean_exec_time::numeric, 2) AS mean_ms,
       s.shared_blks_read, s.query
FROM pg_stat_statements s
JOIN pg_roles r ON r.oid = s.userid
WHERE s.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND s.query ~* '^\s*(select|with)'
ORDER BY s.rows DESC
LIMIT 25;

-- application_name identifies current API/cron/local/ingest connections after
-- rollout. pg_stat_statements groups by role and query, not application_name.
SELECT usename AS role, application_name, state, wait_event_type, wait_event,
       count(*) AS connections,
       max(now() - query_start) FILTER (WHERE state = 'active') AS oldest_active
FROM pg_stat_activity
WHERE datname = current_database() AND backend_type = 'client backend'
  AND pid <> pg_backend_pid()
GROUP BY 1, 2, 3, 4, 5
ORDER BY connections DESC;

COMMIT;
