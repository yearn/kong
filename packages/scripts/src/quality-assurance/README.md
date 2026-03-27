# Quality Assurance Scripts

Scripts for detecting and repairing data quality issues in Kong's data.

## tvl-detect-gaps.ts

Scans vault timeseries for missing, zero, or incomplete data points and reports them.

### Gap types

- **missing** — no data point exists for that day
- **zero** — TVL is 0, classified further as:
  - `price` — missing or zero asset price
  - `snapshot` — missing totalAssets
  - `computation` — both price and totalAssets exist but TVL is still 0
- **incomplete** — TVL > 0 but totalAssets is null

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--chain, -c` | Filter by chain ID | all chains |
| `--address, -a` | Filter by vault address | all vaults |
| `--start` | Start date (ISO format) | no limit |
| `--end` | End date (ISO format) | no limit |
| `--min-tvl` | Only check vaults with latest TVL above this USD value | no limit |
| `--concurrency, -n` | Parallel queries | 10 |
| `--json, -j` | Write JSON report to file | none |

### Examples

```sh
# scan all vaults over all time
bun run tvl-detect-gaps.ts

# scan a specific chain
bun run tvl-detect-gaps.ts --chain 1

# scan a single vault
bun run tvl-detect-gaps.ts --chain 1 --address 0x1234...abcd

# only vaults with TVL >= $100k, output JSON
bun run tvl-detect-gaps.ts --min-tvl 100000 --json gaps.json

# scan a date range
bun run tvl-detect-gaps.ts --start 2024-06-01 --end 2024-12-31
```

## tvl-backfill.ts

Recomputes and backfills `tvl-c` timeseries data for specific vaults. Runs in two modes.

### Modes

**`--update totalAssets`** — Fetches on-chain `totalAssets()` via multicall at end-of-day blocks (resolved through DefiLlama) and upserts into the `output` table.

**`--update tvls`** — Reads stored `totalAssets` from the database, fetches historical asset prices from DefiLlama, computes `tvl = totalAssets * priceUsd`, and upserts `tvl`, `priceUsd`, and `price` table rows.

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--update` | Mode: `totalAssets` or `tvls` | required |
| `--vaults` | Comma-separated `chainId:address` pairs | required |
| `--start` | Start date (ISO format) | 2024-01-01 |
| `--end` | End date (ISO format) | yesterday |
| `--dry-run` | Preview without writing to the database | false |

### Examples

```sh
# backfill totalAssets for two vaults
bun run tvl-backfill.ts --update totalAssets \
  --vaults 1:0x1234...abcd,1:0x5678...ef01

# then compute tvls from the backfilled totalAssets
bun run tvl-backfill.ts --update tvls \
  --vaults 1:0x1234...abcd,1:0x5678...ef01

# backfill a specific date range
bun run tvl-backfill.ts --update totalAssets \
  --vaults 42161:0xaaaa...bbbb \
  --start 2024-06-01 --end 2024-09-30

# dry run to preview what would be written
bun run tvl-backfill.ts --update tvls \
  --vaults 8453:0xcccc...dddd --dry-run
```

### Typical workflow

1. Run `tvl-detect-gaps.ts` to identify vaults with gaps
2. Run `tvl-backfill.ts --update totalAssets` to backfill on-chain data
3. Run `tvl-backfill.ts --update tvls` to compute TVL from the backfilled data
4. Re-run `tvl-detect-gaps.ts` to verify the gaps are resolved

## Environment

Both scripts read from a `.env` file in this directory. Required variables:

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `POSTGRES_SSL` — set to `true` for SSL (default: false)
- `HTTP_ARCHIVE_{chainId}` — archive RPC URLs (backfill only)
- `DEFILLAMA_API` — DefiLlama base URL (default: https://coins.llama.fi)
