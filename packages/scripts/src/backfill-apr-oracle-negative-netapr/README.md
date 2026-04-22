# backfill-apr-oracle-negative-netapr

Backfill scripts for v3 vault apr-oracle output rows where `netApr` / `netApy` were stored as a negative number because the management + performance fees exceeded the gross APR.

## Background

`computeNetApr` previously returned `(grossApr - managementFee) * (1 - performanceFee)` unconditionally. When the vault's oracle reports a very small positive gross APR (below the management fee), the expression goes negative, so historical rows were written with negative `netApr` (and correspondingly negative `netApy` from `computeApy`).

Yearn's accountant caps management + performance fees at **50% of profit**, so the true lower bound for net APR is `grossApr / 2`. The hook has been fixed to enforce that floor, but existing timeseries rows still carry the negative values. This backfill rewrites them to `grossApr / 2` (and `netApy` to `computeApy(grossApr / 2)`) to match the new invariant.

## Scripts

### 1. compute.ts

Copies every affected `apr-oracle` / `netApr` + `netApy` row into a temp table with `value` rewritten to the `grossApr / 2` floor. Skips rows that have no matching same-series_time gross `apr` row or where gross is non-positive (nothing to floor against).

- Writes to `output_temp_netapr_floor_backfill`
- Matches the existing schema of `output_temp_apr_oracle_backfill` so downstream tooling behaves identically

```
bun packages/scripts/src/backfill-apr-oracle-negative-netapr/compute.ts
```

### 2. upsert.ts

Promotes floored values from the temp table into the production `output` table, then drops the temp table.

```
bun packages/scripts/src/backfill-apr-oracle-negative-netapr/upsert.ts [--dry-run]
```

## Workflow

```
compute.ts  -->  upsert.ts
```

1. Run `compute.ts` to stage the floored rows
2. Run `upsert.ts --dry-run` to preview, then `upsert.ts` to apply
3. Trigger a snapshot refresh so updated values propagate to the REST cache

## Verification

After `upsert.ts` runs, this should return `0`:

```sql
SELECT COUNT(*) FROM output
WHERE label = 'apr-oracle'
  AND component IN ('netApr', 'netApy')
  AND value < 0;
```
