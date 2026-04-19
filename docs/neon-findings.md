# Neon Postgres Egress Findings

Diagnostic run against production Neon DB (`ep-raspy-art-a5g9bur0-pooler.us-east-2.aws.neon.tech`) on 2026-04-18. Source: `pg_stat_statements` + codebase audit.

## Top application-level offenders (from pg_stat_statements)

Neon/system monitoring queries filtered out.

| # | Query | Location | Calls | Total exec | Issue |
|---|-------|----------|-------|------------|-------|
| 1 | `label LIKE '%-estimated-apr'` | `web/app/api/rest/snapshot/db.ts:151`, `ingest/helpers/apy-apr.ts:30,37` | 2,300 | 819s | Wildcard LIKE prevents btree index use |
| 2 | `SELECT defaults FROM thing WHERE label='erc20'` then JS filter/sort/project | `web/app/api/gql/resolvers/tokens.ts` | — | — | Fetches full JSONB blob for all 724 tokens |
| 3 | `hook->'apr'` reports query, LIMIT 1000 | `web/app/api/rest/reports/db.ts:115`, `gql/resolvers/vaultReports.ts:38` | 1,699 | 450s | Returns wide hook JSON per row |
| 4 | `SELECT * FROM thing WHERE label = $1` | `ingest/things.ts:10` | 8+ | — | No-op: thing has only 4 columns |

## Table width measurements

- `thing.defaults`: avg 255 B, max 542 B
- `snapshot.snapshot`: avg 886 B, max 7 KB
- `snapshot.hook`: avg 1.5 KB, max 43 KB
- `evmlog.hook` (StrategyReported): avg 301 B, max 376 B

## Refresh script cadence

REST endpoints serve from Redis. DB queries only run in refresh scripts (cron via GitHub Actions).

| Refresh | Cron | Runs/day | DB queries/run |
|---------|------|----------|----------------|
| snapshot | `*/15 * * * *` | 96 | ~6,300 (1 + 2,109 × up to 3) |
| list | `*/15 * * * *` | 96 | 1 big projected query |
| reports | `0 * * * *` | 24 | ~2,110 |
| reports-historical | `0 0 * * *` | 1 | ~2,110 |
| timeseries | `0 * * * *` | 24 | ~8,437 (2,109 × 4 labels) |
| timeseries-historical | `0 0 * * *` | 1 | ~8,437 |

Vault count: 2,109. snapshot table has 4,179 rows total.

## Fixes applied

**New file:** `packages/lib/estimatedApr.ts` — shared `ESTIMATED_APR_LABELS` constant with 5 labels enumerated from prod DB (`aero-estimated-apr`, `crv-estimated-apr`, `katana-estimated-apr`, `velo-estimated-apr`, `yvusd-estimated-apr`).

**Fix #1 — LIKE → `= ANY(text[])`** (biggest perf win: 2,300 calls, 819s exec time → index-eligible):
- `packages/web/app/api/rest/snapshot/db.ts:151`
- `packages/ingest/helpers/apy-apr.ts:30,37`

**Fix #2 — `tokens` GraphQL resolver** (stop fetching full JSONB + JS filter/sort/project):
- `packages/web/app/api/gql/resolvers/tokens.ts` — pushed `chainId` filter, sort, and field projection into SQL via `defaults->>` accessors.

**Fix #3 — reverted:** `things.ts` `SELECT *` → projected columns was a no-op since `thing` has only 4 columns (`chain_id, address, label, defaults`).

## Audit of `packages/web/app/api/rest/` (already well-optimized)

- `list/db.ts:getVaultsList` — projects specific JSONB paths, caches to Redis. No changes needed.
- `timeseries/db.ts` — server-side `time_bucket` + `AVG` aggregation, recent scoped to 2 days. No changes needed.
- `reports/db.ts` — `LIMIT 1000`, projects specific `hook->>` fields. No changes needed.
- `snapshot/db.ts:getVaultSnapshot` — pulls whole `snapshot.snapshot` + `snapshot.hook` by design (endpoint merges via spread).

## Open opportunities (not yet applied)

1. **Batch refresh scripts** — snapshot/reports/timeseries refreshes loop per-vault (2,109 queries × N labels). Collapsing into set-based queries (`WHERE (chain_id, address) IN (...)`) would cut per-run query count by ~100× and reduce Neon compute-time billing. Biggest candidate: snapshot-refresh (~605k queries/day across 96 runs).

2. **N+2 estimated-APR hydration in `getVaultSnapshot`** — `resolveEstimatedAprLabel` + `fetchLatestEstimatedAprRows` run sequentially per vault with composition. Could merge into a single query or fetch labels in bulk at refresh start.

3. **`getVaults()` duplicated** across `snapshot/db.ts`, `timeseries/db.ts`, `reports/db.ts`. Low impact; worth centralizing to `packages/lib/` for clarity.

## Verification commands

```sql
-- Reset stats to measure post-fix impact
SELECT pg_stat_statements_reset();

-- After a representative traffic window, re-run:
SELECT query, calls, rows, round(total_exec_time::numeric, 2) AS total_ms
FROM pg_stat_statements
WHERE query ILIKE '%estimated-apr%'
ORDER BY total_exec_time DESC;
```

Expected: LIKE query should disappear; replaced by `label = ANY($3::text[])` calls with significantly lower avg exec time.
