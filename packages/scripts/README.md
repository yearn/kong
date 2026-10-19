# scripts

One-off / ops scripts for Kong (backfills, QA, migrations).

```bash
bun i
```

## Quality assurance

See [`src/quality-assurance/README.md`](./src/quality-assurance/README.md).

## Database usage diagnosis

Run [`src/diagnose-db-usage.sql`](./src/diagnose-db-usage.sql) through `psql` on
the primary and each active read replica. Save samples before and after a
representative workload and compare counters by database role and query ID,
only within the same statistics-reset window. The script is read-only and never
resets counters. Returned row counts are an egress indicator, not byte counts;
execution time includes waits and is not CPU time.

Connection names distinguish deployed API, refresh jobs, local processes and
ingestion after rollout. Historical query totals do not retain those connection
names. Refresh logs include the job name and deployment; the historical
timeseries summary also reports full/incremental counts and rows read.

### compare-rest-prod-fork (issue #439 Phase 2)

Compares **prod Kong REST** (`https://kong.yearn.fi` by default) against a **fork** REST base (Neon branch trial).

```bash
# required: --fork is your trial deployment; prod is always the baseline
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork http://localhost:3001

# explicit prod URL (defaults to https://kong.yearn.fi)
bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --prod https://kong.yearn.fi \
  --fork https://your-fork.example.com \
  --json /tmp/price-compare.json
```

What it pulls from **both** sides for BTC / ETH / Curve / YVUSD / YBOLD:

- `GET /api/rest/list/vaults` — `tvl`, `pricePerShare`, performance
- `GET /api/rest/snapshot/:chainId/:address` — `tvl`, `totalAssets`, `pricePerShare`
- `GET /api/rest/timeseries/tvl/...` — recent `tvl`, `priceUsd`, `totalAssets`

Slight intraday drift is expected; exit `1` if price-influenced fields (or missing vaults) exceed thresholds. Full options and defaults are in the [QA README](./src/quality-assurance/README.md#compare-rest-prod-forkts).
