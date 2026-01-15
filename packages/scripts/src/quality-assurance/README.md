# Quality Assurance Scripts

## timeseries-gaps.ts

Detects gaps in vault timeseries data. Identifies two types of issues:

- **Missing gaps**: Timestamp intervals greater than 1 day (missing data points)
- **Zero gaps**: Periods where values drop to 0 after having non-zero data

### Setup

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | Database host | (required) |
| `POSTGRES_DATABASE` | Database name | (required) |
| `POSTGRES_USER` | Database user | (required) |
| `POSTGRES_PASSWORD` | Database password | (required) |
| `POSTGRES_SSL` | Enable SSL | `true` |
| `POSTGRES_PORT` | Database port | `5432` |
| `API_BASE` | Timeseries API base URL | `https://kong.yearn.fi/api/rest/timeseries` |

### Usage

```bash
# Check all vaults across all chains
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts

# Filter by chain
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts --chain 1

# Filter by specific vault address
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts --address 0x1234...

# Filter by timeseries label
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts --label tvl

# Output JSON to file (in addition to console report)
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts --json report.json

# Adjust concurrency (default: 10)
bun packages/scripts/src/quality-assurance/timeseries-gaps.ts --concurrency 20
```

### Options

| Flag | Short | Description |
|------|-------|-------------|
| `--chain` | `-c` | Filter by chain ID (1, 10, 137, 250, 8453, 42161) |
| `--address` | `-a` | Filter by vault address (0x format) |
| `--label` | `-l` | Filter by timeseries label (tvl, pps, apy-historical) |
| `--concurrency` | `-n` | Number of concurrent API requests (default: 10) |
| `--json <file>` | `-j` | Write JSON report to file |

### Timeseries Labels

| Label | Segment | Component |
|-------|---------|-----------|
| tvl-c | tvl | tvl |
| pps | pps | humanized |
| apy-bwd-delta-pps | apy-historical | net |

### Example Output

```
=== Timeseries Gap Report ===

Chain 1 (Mainnet):
  0x1234...:
    tvl-c: 2 zero-value gap(s), 1 missing gap(s) (15 total gap days, 5/100 zeros)
      - [ZERO] 2024-01-15 to 2024-01-20 (5 days)
      - [MISSING] 2024-02-01 to 2024-02-08 (7 days)

Summary:
  Total vaults checked: 150
  Vaults with gaps: 12
  Total gaps found: 25
  Total gap days: 180
```

---

## timeseries-backfill-tvl-c-tvl.ts

Backfills zero-value gaps in tvl-c timeseries data by recomputing TVL using archive RPC nodes.

### How it works

1. Reads gap report JSON from `timeseries-gaps.ts`
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
bun packages/scripts/src/quality-assurance/timeseries-backfill-tvl-c-tvl.ts --input gaps.json --dry-run

# Run the backfill
bun packages/scripts/src/quality-assurance/timeseries-backfill-tvl-c-tvl.ts --input gaps.json

# With custom price tolerance (default: 86400 seconds = 1 day)
bun packages/scripts/src/quality-assurance/timeseries-backfill-tvl-c-tvl.ts --input gaps.json --price-tolerance 172800

# Save report to file
bun packages/scripts/src/quality-assurance/timeseries-backfill-tvl-c-tvl.ts --input gaps.json --output report.json
```

### Options

| Flag | Short | Description |
|------|-------|-------------|
| `--input <file>` | `-i` | Path to gaps JSON file (required) |
| `--output <file>` | `-o` | Path to write results report JSON |
| `--dry-run` | `-d` | Preview changes without updating database |
| `--price-tolerance` | `-t` | Max age in seconds for price lookup (default: 0) |
| `--concurrency` | `-c` | Number of dates to process in parallel (default: 5) |

### Notes

- Only processes `zero` type gaps (not `missing` gaps)
- Uses archive RPC nodes to fetch historical `totalAssets` values
- Price lookup uses tolerance to find nearest price within the specified window
- When price lookup fails (returns 0), the day is skipped and logged to report
- Updates existing rows in the output table
