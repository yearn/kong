# Neon CPU Cost Analysis — Kong

Date: 2026-05-13
Project: `green-frog-37871507` (kong, `ep-raspy-art-a5g9bur0`, pg16)
Billing-period CPU used: **6,403,234 sec ≈ 1,778 CPU-hours**
Compute autoscale: 0.25 → 4 CU, suspend_timeout 0 (never suspends)

## TL;DR

Two queries account for **74% of total exec time** (~5,800 hrs of cumulative DB work in the window pg_stat_statements covers). Seven queries account for **~99%**. All are reads against `evmlog` (5 M rows, 5.9 GB) and `output` (hypertable). Root causes:

1. **No indexes on `evmlog` beyond the PK.** PK is `(chain_id, address, signature, …)` — every query that omits `address` falls back to scanning the whole table. The hottest query is run **1.17 M times** and averages **9.4 s per call**.
2. **`output` queries with no `series_time` predicate** force scans across every Timescale chunk.
3. **Per-vault snapshot hot loop** re-fetches data that rarely changes (debt allocator, strategy performance). No caching.
4. **`SELECT DISTINCT block_time` from `output`** is fired **12.7 M times** by the timeseries fanout — once per (vault × label) per fanout cycle.

Fixing #1 + #3 alone should cut CPU cost by **>60%**. Fixing #2 + #4 takes another **20-30%** off.

---

## pg_stat_statements top consumers (window: ~7,778 cumulative DB-hours)

| # | % | total ms | calls | mean ms | shared blks read | Query / source |
|---|---|---|---|---|---|---|
| 1 | **39.4%** | 11,019,802,476 | 1,172,145 | 9,401 | 31.8 B | `SELECT args FROM evmlog WHERE chain_id=$1 AND signature=$2 AND args->>'vault'=$3 ORDER BY block_number DESC LIMIT 1` — `packages/ingest/abis/yearn/3/vault/snapshot/hook.ts:212` (`projectDebtAllocator`) |
| 2 | **35.0%** | 9,806,956,556 | 287,189 | 34,148 | 67.5 B | `WITH latest_times AS (SELECT address,label,MAX(block_time) FROM output … GROUP BY …) SELECT o.* FROM output o JOIN latest_times …` — `vault/snapshot/hook.ts:405` (`fetchStrategyPerformance`) |
| 3 | 8.7% | 2,428,400,141 | 12,686,510 | 191 | 17.3 B | `SELECT DISTINCT block_time FROM output WHERE chain_id=$1 AND address=$2 AND label=$3 ORDER BY block_time ASC` — `packages/ingest/fanout/timeseries.ts:31` |
| 4 | 6.5% | 1,817,284,136 | 2,874,418 | 632 | 14.9 B | `SELECT … MAX(CASE WHEN component=…) … FROM output WHERE block_time=(SELECT MAX(block_time) …)` — apy resolvers |
| 5 | 4.3% | 1,210,149,744 | 6,851,757 | 177 | 4.9 B | `time_bucket(...) … COALESCE(LAST(NULLIF(value,$6), block_number), $7) AS close FROM output` — sparkline / timeseries resolver |
| 6 | 2.9% | 802,526,037 | 2,265,924 | 354 | 5.4 B | `SELECT … MAX(CASE WHEN component=$3 THEN value END) AS apr, … FROM output WHERE block_time=(SELECT MAX(block_time)…)` |
| 7 | 2.5% | 703,976,426 | 1,171,755 | 601 | 6.0 B | `SELECT label, component, value FROM output WHERE block_time=(SELECT block_time … WHERE label LIKE $3 AND block_time > NOW()-INTERVAL $4 …)` |
| 8 | 0.8% | 210,807,800 | 4,426 | 47,629 | 2.0 B | `SELECT event_name, count(*) FROM evmlog GROUP BY event_name ORDER BY count DESC` — diagnostic/probe (47 s per call; runs from `probe/index.ts`) |

Schema snapshot:

- `evmlog`: 5,061,449 rows / 5,893 MB. **Indexes**: only `evmlog_pkey` on `(chain_id, address, signature, block_number, log_index, transaction_hash)`.
- `output`: hypertable on `series_time`. Indexes: `(chain_id, address)`, `(label, component, block_time DESC)`, PK `(chain_id, address, label, component, series_time)`, `(series_time DESC)`.
- `price`: 124 M rows / 30 GB (out of scope — already on a separate optimization track per Feb invoice work).

---

## Root cause per query

### #1 — `projectDebtAllocator` (39.4%)

```ts
// packages/ingest/abis/yearn/3/vault/snapshot/hook.ts:207
SELECT args FROM evmlog
WHERE chain_id = $1 AND signature = $2 AND args->>'vault' = $3
ORDER BY block_number DESC, log_index DESC LIMIT 1
```

- No usable index. `(chain_id, signature)` is not a left-prefix of `evmlog_pkey` (which is `(chain_id, address, signature, …)`).
- Planner has to do a sequential scan / bitmap heap scan across the entire `evmlog` table (~5 M rows, 5.9 GB) **once per call**.
- Mean cost: 9.4 s, **27 KB of shared buffer reads per call**.
- Called **1.17 M times** — once per v3 vault snapshot. Result rarely changes (NewDebtAllocator fires at most once per vault per allocator change).

### #2 — `fetchStrategyPerformance` (35.0%)

```ts
// packages/ingest/abis/yearn/3/vault/snapshot/hook.ts:404
WITH latest_times AS (
  SELECT address, label, MAX(block_time) AS block_time
  FROM output
  WHERE chain_id = $1 AND address = ANY($2) AND label = ANY($3)
  GROUP BY address, label
)
SELECT o.address, o.label, o.component, o.value
FROM output o
JOIN latest_times lt USING (address, label) -- + block_time
WHERE o.chain_id = $1
```

- **No `series_time` predicate** → Timescale must touch every chunk in the hypertable.
- `MAX(block_time)` GROUP BY across all history per (address, label) is brute-force.
- The same file (rank #23 query) already has a variant that adds `series_time >= now() - $4::interval` — the cheap version exists, just not used in the hot path.
- Mean cost: **34 s** per call, **67 B** blocks read.

### #3 — Timeseries fanout `DISTINCT block_time` (8.7%)

```ts
// packages/ingest/fanout/timeseries.ts:25
SELECT DISTINCT block_time FROM output
WHERE chain_id = $1 AND address = $2 AND label = $3
ORDER BY block_time ASC
```

- Fired **12.7 M times** — multiplied by every (vault × output_label) every fanout cycle.
- Mean 191 ms = ~36 ms × full chunk scan because best index is `(chain_id, address)` then has to filter label & DISTINCT block_time.
- Total work is dominated by repeated work, not per-call cost. Result barely changes between cycles.

### #4 / #6 / #7 — "latest snapshot" aggregations against `output`

```sql
WHERE block_time = (SELECT MAX(block_time) FROM output WHERE chain_id=$1 AND address=$2 …)
```

- Same pattern: no `series_time` lower bound → all chunks scanned to find max, then again to fetch row.

### #5 — sparkline `time_bucket + LAST()` (4.3%)

- Used by GQL resolver (`timeseries`) on every page load. 6.85 M calls in window. The `(label, component, block_time DESC)` index helps but still re-scans many chunks per call. Caching at the resolver level (60 s TTL) would erase most of it.

### #8 — diagnostic full-table count (0.8%)

- Cheap line item but **47 s per call**. Find/kill the caller, or back it with `pg_stat_user_tables.n_live_tup` instead of `COUNT(*)`.

---

## Why CPU doubled since the start of the year

- Vault count grew (more snapshot hooks per cycle → linear growth in calls #1, #2, #3).
- Compute config is `min_cu=0.25, max_cu=4, suspend_timeout=0` (never suspends) → ingest workload keeps the larger compute pinned. Neon's new CU-hour billing meters this directly.
- No backpressure on snapshot/fanout retries; replays multiply the same expensive reads.

---

## Fix plan (in order of materiality)

| Step | Target | Expected CPU drop | Risk |
|---|---|---|---|
| 1. Index `evmlog(chain_id, signature, block_number DESC, log_index DESC)` (+ expr index on `(chain_id, signature, (args->>'vault'))`) | #1, parts of vaultReports / strategyReports | ~35-40% | Low — `CREATE INDEX CONCURRENTLY` |
| 2. Add `series_time >= now() - interval '7 days'` predicate to `fetchStrategyPerformance` (output is hypertable on series_time → chunk exclusion). Switch CTE→`DISTINCT ON`. | #2 | ~25-30% | Low — semantics unchanged for "latest" |
| 3. Cache `projectDebtAllocator` result inside the vault snapshot row (store in `snapshot.snapshot` JSON or `thing.defaults`), only re-query when allocator unknown or every Nth cycle | #1 (multiplicative on top of indexing) | extra ~5% | Low |
| 4. Replace `SELECT DISTINCT block_time` fanout probe with a `MAX(block_time)` per-key call + cached set, or only fire when a job is actually missing | #3 | ~6-8% | Low |
| 5. Index `output(chain_id, address, label, series_time DESC)` so #4/#6/#7 use index-only scan + chunk exclusion | #4, #6, #7 | ~6-8% | Low — Timescale safe |
| 6. Resolver-level cache (in-memory 30-60 s) for `timeseries` and `tvls` GQL queries | #5 | ~3-4% | Low (data already sampled at >= 1 day) |
| 7. Tune compute: keep `min_cu` at 0.25 but enable `suspend_timeout_seconds=300` on read replica branches that aren't running ingest | flat CU-hour bill on idle | varies | Low |
| 8. Find/silence `event_name COUNT(*)` probe in `packages/ingest/probe/index.ts` | #8 | <1% | Low |

Combined expected reduction: **>70% of monthly CPU-seconds**.

---

## Notes on what is NOT in this plan

- `price` table is huge but barely shows up in CPU top — it's an egress / storage problem, already covered separately.
- `snapshot`/`thing` are tiny; not worth touching.
- We are not changing schema beyond adding indexes — pkey changes would force a long lock-rewrite cycle.
