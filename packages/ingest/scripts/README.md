# Ingest Scripts

Scripts that need direct access to indexer internals (RPC clients, price fetching, database, etc.).

## backfill-tvl-c.ts

Backfills zero-value gaps in tvl-c timeseries data by recomputing TVL using archive RPC nodes.

### How it works

1. Reads gap report JSON from `packages/scripts/src/quality-assurance/timeseries-gaps.ts`
2. For each vault with tvl-c zero gaps:
   - Fetches `totalAssets` from archive RPC at the historical block
   - Fetches price from price table (with tolerance for nearest match)
   - Computes `tvl = totalAssets * priceUsd` using the indexer's `_compute` function
   - Updates `tvl`, `priceUsd`, and `totalAssets` components in output table
3. Generates a report of any price lookup failures

### Prerequisites

- Archive RPC nodes configured in `.env` (`HTTP_ARCHIVE_*`)
- Database credentials configured in `.env`

### Usage

All commands run from repo root:

```bash
# First, generate the gaps report
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts \
  --chain 1 --address 0xBF319dDC2Edc1Eb6FDf9910E39b37Be221C8805F \
  --label tvl-c --json gaps.json

# Preview what would be backfilled (dry run)
bun packages/ingest/scripts/backfill-tvl-c.ts --input gaps.json --dry-run

# Run the backfill
bun packages/ingest/scripts/backfill-tvl-c.ts --input gaps.json

# With custom price tolerance (default: 86400 seconds = 1 day)
bun packages/ingest/scripts/backfill-tvl-c.ts --input gaps.json --price-tolerance 172800

# Save report to file
bun packages/ingest/scripts/backfill-tvl-c.ts --input gaps.json --output report.json
```

### Options

| Flag | Short | Description |
|------|-------|-------------|
| `--input <file>` | `-i` | Path to gaps JSON file (required) |
| `--output <file>` | `-o` | Path to write results report JSON |
| `--dry-run` | `-d` | Preview changes without updating database |
| `--price-tolerance` | `-t` | Max age in seconds for price lookup (default: 86400) |
| `--concurrency` | `-c` | Number of dates to process in parallel (default: 5) |

### Notes

- Only processes `zero` type gaps (not `missing` gaps)
- Uses archive RPC nodes to fetch historical `totalAssets` values
- Price lookup uses tolerance to find nearest price within the specified window
- When price lookup fails (returns 0), the day is skipped and logged to report
- Updates existing rows in the output table
