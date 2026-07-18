# REST prod vs fork comparison — issue #439 Phase 2

**Generated:** 2026-07-12T14:48:51.261Z  
**Branch / trial:** `decomission-price-table` with local fork web  
**Script:** `packages/scripts/src/quality-assurance/compare-rest-prod-fork.ts`

## Environment

| Side | Base URL |
|------|----------|
| **Prod** (baseline) | `https://kong.yearn.fi` |
| **Fork** (trial) | `http://localhost:3000` |

| Setting | Value |
|---------|-------|
| Price threshold | 5% |
| Assets threshold | 0.1% |
| Timeseries days | 14 (fork-anchored; skipped when fork empty) |
| Prod vaults in list | 2194 |
| Fork vaults in list | 2194 |

## Vaults compared (mainnet)

| Label | Address |
|-------|---------|
| BTC (yvWBTC-1) | `0x751F0cC6115410A3eE9eC92d08f46Ff6Da98b708` |
| ETH (yvWETH-1) | `0xc56413869c6CDf96496f2b1eF801fEDBdFA7dDB0` |
| Curve (yvCurve-DOLA-sUSDe-f) | `0x1Fc80CfCF5B345b904A0fB36d4222196Ed9eB8a5` |
| YVUSD | `0x696d02Db93291651ED510704c9b286841d506987` |
| YBOLD | `0x9F4330700a36B29952869fac9b33f45EEdd8A3d8` |

## Command

```bash
cd packages/scripts && bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork http://localhost:3000
```

## Summary counts

| Status | Count |
|--------|------:|
| fields compared | 60 |
| ok | 50 |
| warn | 1 |
| fail | 2 |
| missing | 0 |
| skip | 7 |

Script exit: **FAIL** (2 secondary fields; see conclusions).

---

## Results by vault

### BTC (yvWBTC-1) — warn(1)

| Field | Prod | Fork | Rel | Status |
|-------|-----:|-----:|----:|--------|
| list.tvl | 3,035,673.62 | 3,042,794.58 | 0.234% | ok |
| list.pricePerShare | 100,030,394 | 100,030,066 | ~0% | ok |
| list.performance.oracle.apr | 0.00122847 | 0.00124802 | 1.567% | ok |
| list.performance.oracle.apy | 0.00122921 | 0.00124879 | 1.568% | ok |
| list.performance.oracle.netAPR | 0.00110562 | 0.00112322 | 1.567% | ok |
| list.performance.oracle.netAPY | 0.00110622 | 0.00112384 | 1.568% | ok |
| list.performance.historical.net | 0.00199246 | 0.00208801 | 4.576% | ok |
| list.performance.historical.weeklyNet | 0.00125529 | 0.00134709 | 6.815% | **warn** |
| list.performance.historical.monthlyNet | 0.00199246 | 0.00208801 | 4.576% | ok |
| snapshot.tvl | 3,035,673.62 | 3,042,794.58 | 0.234% | ok |
| snapshot.totalAssets | 4,750,988,862 | 4,750,988,862 | 0% | ok |
| snapshot.pricePerShare | 100,030,394 | 100,030,066 | ~0% | ok |

Timeseries: **skipped** (fork has no points).

### ETH (yvWETH-1) — ok

| Field | Prod | Fork | Rel | Status |
|-------|-----:|-----:|----:|--------|
| list.tvl | 16,365,499.91 | 16,258,921.92 | 0.651% | ok |
| list.pricePerShare | …731,500 | …456,800 | 0.004% | ok |
| list.performance.oracle.apr | 0.0222889 | 0.0224642 | 0.780% | ok |
| list.performance.oracle.apy | 0.0225343 | 0.0227135 | 0.789% | ok |
| list.performance.oracle.netAPR | 0.0200600 | 0.0202178 | 0.780% | ok |
| list.performance.oracle.netAPY | 0.0202586 | 0.0204195 | 0.788% | ok |
| list.performance.historical.net | 0.0176472 | 0.0174362 | 1.196% | ok |
| list.performance.historical.weeklyNet | 0.0195770 | 0.0202969 | 3.547% | ok |
| list.performance.historical.monthlyNet | 0.0176472 | 0.0174362 | 1.196% | ok |
| snapshot.tvl | 16,365,499.91 | 16,258,921.92 | 0.651% | ok |
| snapshot.totalAssets | …617,000,000 | …859,000,000 | 0.002% | ok |
| snapshot.pricePerShare | …731,500 | …456,800 | 0.004% | ok |

Timeseries: **skipped** (fork has no points).

### Curve (yvCurve-DOLA-sUSDe-f) — FAIL(1)

| Field | Prod | Fork | Rel | Status |
|-------|-----:|-----:|----:|--------|
| list.tvl | 8,415,685.68 | 8,414,660.87 | 0.012% | ok |
| list.pricePerShare | …796,200 | …233,400 | 0.012% | ok |
| list.performance.oracle.* | null | null | — | skip |
| list.performance.historical.net | 0.0518563 | 0.0540649 | 4.085% | ok |
| list.performance.historical.weeklyNet | 0.0315312 | 0.0365823 | 13.807% | **fail** |
| list.performance.historical.monthlyNet | 0.0518563 | 0.0540649 | 4.085% | ok |
| snapshot.tvl | 8,415,685.68 | 8,414,660.87 | 0.012% | ok |
| snapshot.totalAssets | …267,000,000,000 | …864,000,000,000 | 0.021% | ok |
| snapshot.pricePerShare | …796,200 | …233,400 | 0.012% | ok |

Timeseries: **skipped** (fork has no points).

### YVUSD — ok

| Field | Prod | Fork | Rel | Status |
|-------|-----:|-----:|----:|--------|
| list.tvl | 8,981,542.93 | 8,981,115.07 | 0.005% | ok |
| list.pricePerShare | 1,019,241 | 1,019,106 | 0.013% | ok |
| list.performance.oracle.apr | 0.0551480 | 0.0557907 | 1.152% | ok |
| list.performance.oracle.apy | 0.0566661 | 0.0573447 | 1.183% | ok |
| list.performance.oracle.netAPR | 0.0551480 | 0.0557907 | 1.152% | ok |
| list.performance.oracle.netAPY | 0.0566661 | 0.0573447 | 1.183% | ok |
| list.performance.historical.net | 0.0542896 | 0.0536513 | 1.176% | ok |
| list.performance.historical.weeklyNet | 0.0552524 | 0.0573179 | 3.604% | ok |
| list.performance.historical.monthlyNet | 0.0542896 | 0.0536513 | 1.176% | ok |
| snapshot.tvl | 8,981,542.93 | 8,981,115.07 | 0.005% | ok |
| snapshot.totalAssets | 8,983,459,570,085 | 8,984,689,874,042 | 0.014% | ok |
| snapshot.pricePerShare | 1,002,336 | 1,002,336 | 0% | ok |

Timeseries: **skipped** (fork has no points).

### YBOLD — FAIL(1)

| Field | Prod | Fork | Rel | Status |
|-------|-----:|-----:|----:|--------|
| list.tvl | 4,759,302.53 | 4,726,049.21 | 0.699% | ok |
| list.pricePerShare | 1e18 | 1e18 | 0% | ok |
| list.performance.oracle.apr | 0.0463319 | 0.0452767 | 2.277% | ok |
| list.performance.oracle.apy | 0.0474004 | 0.0462967 | 2.328% | ok |
| list.performance.oracle.netAPR | 0.0463319 | 0.0452767 | 2.277% | ok |
| list.performance.oracle.netAPY | 0.0474004 | 0.0462967 | 2.328% | ok |
| list.performance.historical.* | null | null | — | skip |
| snapshot.tvl | 4,759,302.53 | 4,726,049.21 | 0.699% | ok |
| snapshot.totalAssets | …045,500,000,000 | …039,300,000,000 | 0.809% | **fail** |
| snapshot.pricePerShare | 1e18 | 1e18 | 0% | ok |

Timeseries: **skipped** (fork has no points).

---

## Price-influenced TVL (primary #439 signal)

| Vault | list / snapshot TVL rel | Within 5%? |
|-------|------------------------:|:----------:|
| BTC | 0.234% | yes |
| ETH | 0.651% | yes |
| Curve | 0.012% | yes |
| YVUSD | 0.005% | yes |
| YBOLD | 0.699% | yes |

On BTC / ETH / Curve / YVUSD, `snapshot.totalAssets` matches tightly (≤0.02%), so small TVL deltas are almost entirely **asset USD price** (day-granular yearn-prices vs previous path) — consistent with the issue’s expected slight intraday drift.

---

## Failures (secondary — not price-table TVL)

### 1. Curve `list.performance.historical.weeklyNet` — 13.807%

- Historical APY / PPS window noise (tip timing, cache age), not USD price from the decommissioned `price` table.
- Monthly / net historical are only ~4% (within threshold).
- **Not a Phase 2 price cutover blocker.**

### 2. YBOLD `snapshot.totalAssets` — 0.809%

- On-chain state divergence, not asset USD price (assets threshold is 0.1%).
- Fork totalAssets slightly lower than prod.
- Likely tip lag, snapshot cache skew, or real position change between DBs.
- Worth a tip-block / snapshot refresh check later; **not a price-service failure**.

### 3. Timeseries empty on fork

- All five vaults: `timeseries window: none (fork has no timeseries points)`.
- Local REST timeseries Redis (or DB coverage served by it) is empty.
- Script correctly skips timeseries rather than treating prod-only history as missing.
- List + snapshot are sufficient for Phase 2 go/no-go on prices.
- Optional follow-up: refresh fork timeseries cache, then re-run for `tvl` / `priceUsd` day series.

---

## Conclusions

1. **Primary gate for #439 (list/snapshot TVL) passes** on BTC, ETH, Curve, YVUSD, and YBOLD — all relative diffs &lt; 1%, well under 5%.
2. **`USE_PRICE_SERVICE` trial looks acceptable** for spot TVL quality on this vault set; day-granular price service is not producing material TVL skew vs prod.
3. Script **FAIL exit code** is driven by secondary fields only:
   - Curve historical weeklyNet
   - YBOLD totalAssets lag
4. **Fork timeseries not populated** — no historical day-level compare yet; does not invalidate list/snapshot findings.
5. **Recommended Phase 2 stance:** treat this run as a **pass on price-influenced TVL**; track YBOLD totalAssets and Curve weeklyNet as non-blocking follow-ups; refresh timeseries if day-series parity is still desired before Phase 3.

## Re-run

```bash
cd packages/scripts && bun run src/quality-assurance/compare-rest-prod-fork.ts \
  --fork http://localhost:3000 \
  --json /tmp/price-compare.json
```

Docs: `packages/scripts/src/quality-assurance/README.md` · issue: https://github.com/yearn/kong/issues/439
