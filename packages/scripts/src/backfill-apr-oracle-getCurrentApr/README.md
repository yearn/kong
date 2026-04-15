# backfill-apr-oracle-getCurrentApr

Backfill scripts for v3 vault apr-oracle output rows that were stored as `0` even though the oracle currently reports a non-zero APR.

## Background

The apr-oracle timeseries hook reads `getStrategyApr(address, 0)` — the oracle's strategy-level APR — and falls back to `getCurrentApr(address)` for vaults (e.g. multi-strategy vaults) where `getStrategyApr` reverts. Older zero rows need to be checked against the live oracle logic to determine whether they are genuine or need repair.

The backfill flow does that in three steps:

1. Probe distinct vaults with stored `apr=0` rows at the latest block.
2. Recompute historical rows for vaults whose current oracle APR is non-zero.
3. Upsert the corrected rows back into `output`.

## Scripts

### 1. probe.ts

Lightweight diagnostic that identifies which vaults with snapshot oracle `apr=0` actually revert when calling `getStrategyApr` on-chain.

- Queries vaults from the `snapshot` table where `hook.performance.oracle.apr = 0` (v3 + yearn only)
- Calls `getStrategyApr(address, 0)` at the latest block for each vault
- If `getStrategyApr` reverts → vault is faulty, written to `probe-results.json`
- If `getStrategyApr` returns successfully → the zero is treated as genuine and skipped
- Skips chains without oracle config

```
bun packages/scripts/src/backfill-apr-oracle-getCurrentApr/probe.ts
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
