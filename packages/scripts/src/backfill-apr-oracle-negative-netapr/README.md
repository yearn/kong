# backfill-apr-oracle-negative-netapr

Backfill scripts for v3 vault `apr-oracle` output rows where the stored `netApr` or `netApy` is below the new `grossApr / 2` floor (includes all rows that were stored as negative).

## Background

`computeNetApr` previously returned `(grossApr - managementFee) * (1 - performanceFee)` unconditionally. When the management fee (charged on TVL) exceeded a very small gross APR the expression went negative; more generally any row where `(gross - mgmt)(1 - perf) < gross / 2` ended up below the accountant's true 50%-of-profit floor.

The hook has been fixed to enforce `grossApr / 2` as the lower bound (and `0` for non-positive gross). This backfill replays the fixed hook against every stored timeseries bucket whose `netApr` or `netApy` is currently below that floor, so historical rows match current ingestion. Only the `netApr` / `netApy` rows are rewritten — the companion `apr` / `apy` rows are left untouched.

## Scripts

### 1. compute.ts

1. Truncates the temp table `output_temp_netapr_floor_backfill` (every run starts clean).
2. Queries `(chain_id, address, series_time)` tuples where `netApr < apr / 2` (LEFT JOIN on the matching `apr` row). `netApy` is derived from `netApr`, so anchoring on `netApr` is sufficient — the replay recomputes both.
3. Replays `apr-oracle` timeseries hook at each affected `series_time`.
4. Stages the recomputed `netApr` and `netApy` rows into the temp table.

**Skipped rows** (logged as counts, left untouched by this backfill):

- Rows where no matching `apr` row exists for the same `series_time` — we can't evaluate the floor without the gross value.
- Rows where the stored `apr` is negative. Under the fixed hook these would resolve to `netApr = 0`, but we defer to the next natural re-ingest (the regular timeseries fanout) to heal them rather than fabricating a value here.

```
bun packages/scripts/src/backfill-apr-oracle-negative-netapr/compute.ts
```

### 2. upsert.ts

Promotes every row from the temp table into `public.output` and drops the temp table.

```
bun packages/scripts/src/backfill-apr-oracle-negative-netapr/upsert.ts
```

## Workflow

```
compute.ts  -->  upsert.ts
```

## Verification

After `upsert.ts` runs, this should return `0`:

```sql
SELECT COUNT(*)
FROM public.output n
JOIN public.output g
  ON g.chain_id    = n.chain_id
 AND g.address     = n.address
 AND g.label       = 'apr-oracle'
 AND g.component   = 'apr'
 AND g.series_time = n.series_time
WHERE n.label = 'apr-oracle'
  AND n.component IN ('netApr', 'netApy')
  AND n.value < g.value / 2;
```
