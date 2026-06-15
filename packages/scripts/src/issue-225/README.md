# issue-225 — historical fapy + oracle apy recompute (erc4626)

Recomputes historical APY and historical oracle APY for plain erc4626 vaults
affected by the share-vs-asset decimals fix in PR #419 (closes #225).

Some external erc4626 vaults (e.g. Yearn-branded Morpho meta-vaults) have a share
decimal accuracy that differs from their asset (18-share / 6-asset). The old hooks
quoted `convertToAssets` with the asset decimals, which rounded to `0`, so those
vaults recorded a `0` price-per-share → `0` historical APY. Plain erc4626 vaults
also never ran the apr-oracle hook, so they have no historical oracle APY at all.

PR #419 fixes the live hooks. This script backfills the **already-stored, wrong**
history. Reuses the live erc4626 timeseries hooks (`apy/hook.ts`,
`apr-oracle/hook.ts`) — no duplicated compute.

## Why not strides + fanout / replay

Recompute here is **timeseries** data, which lives in the `output` table.
`evmlog_strides` only gates evmlog (event) and snapshot re-indexing — the
timeseries fanout (`ingest/fanout/timeseries.ts`) decides what to compute by
looking for **gaps in the `output` table** (`findMissingTimestamps`), not strides.

Consequence:
- Editing `evmlog_strides` + rerunning fanout does **not** recompute these series —
  the erc4626 timeseries hooks don't read evmlog.
- A normal fanout only fills *missing* days. The affected `apy-bwd-delta-pps` rows
  already exist (as `0`), so fanout skips them and only the latest point is fixed.
- `apr-oracle` is a brand-new label for erc4626, so it has no rows — a normal
  fanout **will** backfill its full history on its own. This script also writes it
  so apy and oracle apy land together in one reviewable upsert.

So: do not use the terminal "fanout replays" command for this. Recompute writes the
`output` table directly, via a staging table promoted in a single transaction.

## Labels recomputed

| Label | Components | Meaning |
|---|---|---|
| `apy-bwd-delta-pps` | net, grossApr, pricePerShare, weekly*, monthly*, inception* | historical APY |
| `apr-oracle` | apr, apy | historical oracle APY |

Select a subset with `--labels apy` or `--labels oracle` (default: both).

## Scripts

### `compute.ts`

Reads each vault's daily grid from its existing `apy-bwd-delta-pps` output rows,
recomputes the selected labels at each grid block time with the live hooks, and
writes results to a staging table (`output_temp_fapy_oracle`).

```bash
bun packages/scripts/src/issue-225/compute.ts \
  --vaults 1:0x0963232eB842BAF53E8e517691f81745C1F228a0 \
  [--labels apy,oracle] \
  [--start 2025-01-01] \
  [--end 2026-04-09] \
  [--dry-run]
```

| Flag | Description |
|---|---|
| `--vaults` | Required. Comma-separated `chainId:address` pairs |
| `--labels` | Optional. `apy`, `oracle`, or both (default `apy,oracle`) |
| `--start` | Optional. Only recompute the grid from this date |
| `--end` | Optional. Only recompute the grid up to this date |
| `--dry-run` | Run without writing to the staging table |

Runs `CONCURRENCY=25`. The staging table is reset on each run, so re-run with the
full `--vaults` set you want staged before upserting. Vaults with no
`apy-bwd-delta-pps` history are skipped (run a normal fanout for those). Use
`--dry-run` to preview without writing.

### `upsert.ts`

Promotes rows from the staging table into `output` and drops the staging table in a
single transaction, via the shared `promoteTempTable` helper. On conflict it updates
`value` only — the existing row's `block_time`/`block_number` are kept so downstream
block-time bucketing stays aligned. It prints a sample and per-vault counts before
promoting.

```bash
bun packages/scripts/src/issue-225/upsert.ts
```

## Discovering affected vaults

All plain erc4626 vaults (apr-oracle is new for every one of them):

```sql
SELECT t.chain_id, t.address
FROM thing t
WHERE t.label = 'vault'
  AND t.defaults->>'erc4626' = 'true'
  AND COALESCE(t.defaults->>'yearn', '') <> 'true';
```

The decimals-bug subset (all-zero historical APY → needs the `apy` recompute):

```sql
SELECT t.chain_id, t.address
FROM thing t
JOIN output o
  ON o.chain_id = t.chain_id AND o.address = t.address
WHERE t.label = 'vault'
  AND t.defaults->>'erc4626' = 'true'
  AND COALESCE(t.defaults->>'yearn', '') <> 'true'
  AND o.label = 'apy-bwd-delta-pps' AND o.component = 'net'
GROUP BY t.chain_id, t.address
HAVING bool_and(o.value = 0);
```

## Morpho first (optional)

To validate Morpho before the rest, run the script for the Morpho subset first,
verify, then run it for the remaining vaults — `--vaults` scopes each run.

```bash
# 1. Morpho only (example)
bun packages/scripts/src/issue-225/compute.ts --vaults 1:0x0963232eB842BAF53E8e517691f81745C1F228a0
bun packages/scripts/src/issue-225/upsert.ts

# 2. Remaining affected vaults
bun packages/scripts/src/issue-225/compute.ts --vaults <rest>
bun packages/scripts/src/issue-225/upsert.ts
```

## Workflow

```bash
# 1. Discover affected vaults (queries above)
psql -c "<discovery query>"

# 2. Compute to staging (dry-run first to sanity-check)
bun packages/scripts/src/issue-225/compute.ts --vaults <result> --dry-run
bun packages/scripts/src/issue-225/compute.ts --vaults <result>

# 3. Promote (prints a sample + per-vault counts before upserting)
bun packages/scripts/src/issue-225/upsert.ts

# 4. Refresh cache
bun packages/web/app/api/rest/snapshot/refresh-snapshot.ts
```
