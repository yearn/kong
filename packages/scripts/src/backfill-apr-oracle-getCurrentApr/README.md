# backfill-apr-oracle-getCurrentApr

Backfill scripts for v3 vault apr-oracle output rows that were stored as `0` even though the oracle currently reports a non-zero APR.

## Background

The apr-oracle timeseries hook reads `getStrategyApr(address, 0)` — the oracle's strategy-level APR — and falls back to `getCurrentApr(address)` for regular vaults without a registered strategy oracle where `getStrategyApr` reverts. `getCurrentApr` returns APR based on the vault's profit-unlocking rate. Older zero rows need to be checked against the live oracle logic to determine whether they are genuine or need repair.

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

### Full recompute (safer, recommended for first run)

Running `compute.ts` without `--from-probe` processes **all** v3 vault apr-oracle rows with `apr=0`. This is the safest option because it catches every case — including vaults that historically reverted on `getStrategyApr` but have since had a strategy oracle registered.

```
compute.ts  -->  upsert.ts
```

1. Run `compute.ts --dry-run` to preview scope
2. Run `compute.ts` to recompute APRs for all zero rows
3. Run `upsert.ts --dry-run` to preview, then `upsert.ts` to apply
4. Trigger a snapshot refresh so updated values propagate to the REST cache

### Probe-gated (faster, narrower scope)

Use the probe to target only vaults where `getStrategyApr` currently reverts. Note: this can miss vaults that used to revert but no longer do (e.g., a strategy oracle was registered after the faulty rows were written).

```
probe.ts  -->  probe-results.json  -->  compute.ts --from-probe  -->  upsert.ts
```

1. Run `probe.ts` to identify faulty vaults
2. Run `compute.ts --from-probe` to recompute APRs for those vaults
3. Run `upsert.ts --dry-run` to preview, then `upsert.ts` to apply
4. Trigger a snapshot refresh so updated values propagate to the REST cache
