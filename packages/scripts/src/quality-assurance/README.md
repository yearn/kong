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
