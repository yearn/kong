# backfill-apr-oracle-getCurrentApr

Backfill scripts for v3 vault apr-oracle output rows that were stored as `0` because `getStrategyApr` reverted for vaults without a registered strategy oracle.

## Background

The apr-oracle timeseries hook originally only called `getStrategyApr(vaultAddress, 0)`. For vaults that aren't tokenized strategies, no strategy oracle is registered so `getStrategyApr` **reverts**. The catch block silently set `apr = 0`, producing faulty zero rows.

The fix tries `getStrategyApr` first (works for tokenized strategies), falling back to `getCurrentApr(address)` (weighted average APR across all strategies) when `getStrategyApr` reverts.

## Scripts

### 1. probe.ts

Lightweight diagnostic that identifies which vaults have faulty zeros caused by `getStrategyApr` reverting.

- Queries distinct `chain_id:address` pairs from the `output` table where `apr=0`
- Calls `getStrategyApr` at the **latest block** for each vault
- If `getStrategyApr` reverts → vault is faulty (the bug), written to `probe-results.json`
- If `getStrategyApr` succeeds → vault has a genuine value, skipped
- Skips chains without RPC config

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/probe.ts [--chain-id <N>]
```

### 2. compute.ts

Re-queries the oracle at each **historical block** for affected output rows and writes corrected values to a temp table.

- Supports `--from-probe` to only process vaults identified as faulty by `probe.ts`
- Supports pause/resume: already-computed rows in the temp table are skipped
- Writes to `output_temp_apr_oracle_backfill`

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/compute.ts [--from-probe] [--chain-id <N>] [--dry-run]
```

### 3. upsert.ts

Promotes corrected values from the temp table into the production `output` table, then drops the temp table.

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/upsert.ts [--dry-run]
```

## Workflow

```
probe.ts  -->  probe-results.json  -->  compute.ts --from-probe  -->  upsert.ts
```

1. Run `probe.ts` to identify faulty vaults
2. Run `compute.ts --from-probe` to recompute APRs for those vaults
3. Run `upsert.ts --dry-run` to preview, then `upsert.ts` to apply
4. Trigger a snapshot refresh so updated values propagate to the REST cache
