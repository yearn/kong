# backfill-apr-oracle-getCurrentApr

Backfill scripts for v3 vault apr-oracle output rows that were stored as `0` even though the oracle reports a non-zero APR.

## Background

The apr-oracle timeseries hook reads `getStrategyApr(address, 0)` — the oracle's strategy-level APR — and falls back to `getCurrentApr(address)` for regular vaults without a registered strategy oracle where `getStrategyApr` reverts. `getCurrentApr` returns APR based on the vault's profit-unlocking rate. Older zero rows need to be checked against the oracle to determine whether they are genuine or need repair.

The backfill flow does that in two steps:

1. Recompute historical rows for all vaults with stored `apr=0` rows.
2. Upsert the corrected rows back into `output`.

## Scripts

### 1. compute.ts

Finds vaults with `apr=0` in the output table, then re-queries the oracle once per exact source observation across each affected vault's full history. It writes corrected values to a temp table.

- Writes to `output_temp_apr_oracle_backfill`
- Skips rows where the oracle still returns 0 (no point overwriting a zero with a zero)
- Resumes by skipping only observations with all four APR/APY components staged
- Uses a bounded RPC pool (`RECOMPUTE_CONCURRENCY`, default 25, maximum 100)

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts
```

### 2. upsert.ts

Promotes corrected values from the temp table into the production `output` table, then drops the temp table.

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/upsert.ts [--dry-run]
```

## Workflow

```
compute.ts  -->  upsert.ts
```

1. Run `compute.ts` to recompute APRs for all zero rows
2. Run `upsert.ts --dry-run` to preview, then `upsert.ts` to apply
3. Trigger a snapshot refresh so updated values propagate to the REST cache
