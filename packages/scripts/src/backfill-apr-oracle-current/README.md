# backfill-apr-oracle-current

Backfill the apr-oracle `currentApr` components (issue #437) into historical output rows.

## Background

The apr-oracle timeseries hook now reads the oracle's `getCurrentApr(vault)` as its own components alongside the resolved strategy APR:

- v3 vaults: `currentApr`, `currentApy`, `currentNetApr`, `currentNetApy`
- erc4626 vaults: `currentApr`, `currentApy` (net needs the v3 fee path)

Rows written before this change only have `apr`/`apy`/`netApr`/`netApy`. This backfill adds the `current*` components to those historical points.

## Scripts

### 1. compute.ts

Finds every apr-oracle point (anchored on the `apr` component) that has no `currentApr` row at the same `series_time`, then **replays the real apr-oracle hook** at each point so staged values match production exactly. It picks the v3 or erc4626 hook per vault (from the `thing` classification), and stages only the `current*` components — `apr`/`apy`/`netApr`/`netApy` are left untouched. Points where `getCurrentApr` reverts stage nothing.

- Writes to `output_temp_apr_oracle_current_backfill`
- Idempotent: points already carrying `currentApr` are skipped, so re-runs resume

```
bun packages/scripts/src/backfill-apr-oracle-current/compute.ts
```

### 2. upsert.ts

Promotes the staged rows from the temp table into the production `output` table, then drops the temp table.

```
bun packages/scripts/src/backfill-apr-oracle-current/upsert.ts
```

## Workflow

```
compute.ts  -->  upsert.ts
```

1. Run `compute.ts` to stage the new `current*` rows.
2. Run `upsert.ts` to promote them into `output`.
3. Run the REST timeseries refresh jobs so Redis holds the new `currentApr` history:
   - `packages/web/app/api/rest/timeseries/refresh-historical.ts`
   - `packages/web/app/api/rest/timeseries/refresh.ts`
