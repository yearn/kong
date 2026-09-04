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

Vault metadata is fetched by address in one request via the `addresses` filter.

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

## compare-rest-prod-fork.ts

Issue [#439](https://github.com/yearn/kong/issues/439) Phase 2 verification.

**Always compares against prod.** Prod is the baseline (`--prod`, default `https://kong.yearn.fi`). The fork is the trial side (`--fork`, required) — e.g. local web, Neon branch deploy, or any host running with `USE_PRICE_SERVICE`.

For each vault it hits the same REST paths on **both** bases and diffs price-influenced fields (`tvl`, `priceUsd`) plus on-chain anchors (`totalAssets`, `pricePerShare`).

Slight intraday drift is expected (price service is day-granular). Overall TVL and anything derived from price should stay within `--threshold`.

### What it compares (prod vs fork)

| Source | Fields |
|--------|--------|
| `GET /api/rest/list/vaults` | `tvl`, `pricePerShare`, oracle/historical performance |
| `GET /api/rest/snapshot/:chainId/:address` | `tvl.close`, `totalAssets`, `pricePerShare` |
| `GET /api/rest/timeseries/tvl/...` | last N days of `tvl`, `priceUsd`, `totalAssets`, **anchored to the fork's newest point** (prod-only history ignored; empty fork timeseries is skipped) |

### Default vaults (mainnet)

| Label | Address |
|-------|---------|
| BTC (yvWBTC-1) | `0x751F0cC6115410A3eE9eC92d08f46Ff6Da98b708` |
| ETH (yvWETH-1) | `0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0` |
| Curve (yvCurve-DOLA-sUSDe-f) | `0x1Fc80CfCF5B345b904A0fB36d4222196Ed9eB8a5` |
| YVUSD | `0x696d02Db93291651ED510704c9b286841d506987` |
| YBOLD | `0x9F4330700a36B29952869fac9b33f45EEdd8A3d8` |

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--fork` | Fork / trial base URL (**required**) | — |
| `--prod` | Prod baseline base URL | `https://kong.yearn.fi` |
| `--threshold` | Max relative diff for price fields | `0.05` (5%) |
| `--assets-threshold` | Max relative diff for `totalAssets` / PPS | `0.001` (0.1%) |
| `--days` | Timeseries lookback from the **fork's latest** point | `14` |
| `--vaults` | Comma-separated `chainId:address` pairs | curated set above |
| `--json, -j` | Write full JSON report to file | none |

Status bands:
- **ok** — within threshold
- **warn** — between 1× and 2× threshold (expected slight intraday drift)
- **fail** — beyond 2× threshold
- **missing** — present on one side only

Exit code `1` if any **fail**, **missing**, or vault fetch error. Warn-only is exit `0`.

### Examples

```sh
# compare fork against prod (default prod = https://kong.yearn.fi)
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork http://localhost:3001

# same thing, prod spelled out
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --prod https://kong.yearn.fi \
  --fork https://my-fork.example.com

# tighter price tolerance, full JSON report
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork https://my-fork.example.com \
  --threshold 0.02 \
  --days 30 \
  --json /tmp/price-compare.json

# custom vault set
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork http://localhost:3001 \
  --vaults 1:0x751F0cC6115410A3eE9eC92d08f46Ff6Da98b708,1:0x696d02Db93291651ED510704c9b286841d506987
```

### Environment

No database credentials required — HTTP only against the two REST bases (`--prod` and `--fork`).

---

## Environment

DB-backed scripts (`tvl-detect-gaps`, `tvl-backfill`) read from a `.env` file in this directory. Required variables:

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `POSTGRES_SSL` — set to `true` for SSL (default: false)
- `HTTP_ARCHIVE_{chainId}` — archive RPC URLs (backfill only)
- `DEFILLAMA_API` — DefiLlama base URL (default: https://coins.llama.fi)
