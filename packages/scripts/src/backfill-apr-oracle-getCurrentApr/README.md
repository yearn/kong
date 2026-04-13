# backfill-apr-oracle-getCurrentApr

Backfill scripts for v3 vault apr-oracle output rows that were stored as `0` because the hook was calling `getStrategyApr` instead of `getCurrentApr`.

## Background

The apr-oracle timeseries hook originally called `getStrategyApr(vaultAddress, 0)` which only works for addresses with a registered strategy oracle. For vaults that aren't tokenized strategies, this silently returned 0. The fix calls `getCurrentApr(address)` first (weighted average APR across all strategies), falling back to `getStrategyApr` for tokenized strategies.

## Scripts

### 1. probe.ts

Lightweight diagnostic that identifies which vaults with `apr=0` actually have non-zero APR on-chain.

- Queries distinct `chain_id:address` pairs from the `output` table where `apr=0`
- Calls `getCurrentApr` / `getStrategyApr` at the **latest block** for each vault
- Skips chains without RPC config
- Writes faulty vaults (non-zero APR) to `probe-results.json`

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
