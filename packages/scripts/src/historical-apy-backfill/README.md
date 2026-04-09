# Historical APY Backfill

Recomputes `apy-bwd-delta-pps` output entries for vaults whose APY was incorrect (e.g. nested vaults missing composed PPS). Uses the live `_process`/`_compute` from `ingest/abis/yearn/lib/apy` -- no duplicated logic.

## Scripts

### `compute.ts`

Reads existing `output` entries for the given vaults, recomputes APY at each historical block time, and writes results to a staging table (`output_temp_apy_backfill`).

```bash
bun packages/scripts/src/historical-apy-backfill/compute.ts \
  --vaults 1:0xAaaFEa48472f77563961Cdb53291DEDfB46F9040,137:0x4987d1856F93DFf29e08aa605A805FaF43dC3103 \
  [--start 2025-01-01] \
  [--end 2026-04-09] \
  [--dry-run]
```

| Flag | Description |
|---|---|
| `--vaults` | Required. Comma-separated `chainId:address` pairs |
| `--start` | Optional. Only recompute entries from this date |
| `--end` | Optional. Only recompute entries up to this date |
| `--dry-run` | Run without writing to DB |

Runs with `CONCURRENCY=50` parallel RPC calls. Resumable -- re-running appends to the existing staging table.

### `upsert.ts`

Promotes rows from the staging table into `output` and drops the staging table in a single transaction.

```bash
bun packages/scripts/src/historical-apy-backfill/upsert.ts [--dry-run]
```

Dry run shows row count, sample rows, and distinct vault count without making changes.

## Discovering affected vaults

```sql
SELECT STRING_AGG(t.chain_id || ':' || t.address, ',')
FROM thing t
JOIN thing t2
  ON t2.chain_id = t.chain_id
  AND LOWER(t2.address) = LOWER(t.defaults->>'asset')
  AND t2.label = 'vault'
WHERE t.label = 'vault'
  AND (t.defaults->'v3')::boolean IS TRUE;
```

## Workflow

```bash
# 1. Discover vaults
psql -c "<discovery query above>"

# 2. Compute to staging
bun packages/scripts/src/historical-apy-backfill/compute.ts --vaults <result>

# 3. Verify
bun packages/scripts/src/historical-apy-backfill/upsert.ts --dry-run

# 4. Promote
bun packages/scripts/src/historical-apy-backfill/upsert.ts

# 5. Refresh cache
bun packages/web/app/api/rest/snapshot/refresh-snapshot.ts
```
