# yTranche

How Kong indexes yTranche, and what its numbers mean.

yTranche splits a Yearn vault's yield across tranches with different risk and
return profiles. The tranches are user-facing ERC-4626 vaults; a controller
holds the accounting that decides what each tranche is owed.

## Deployment

**One controller per asset class.** A controller takes its asset and main vault as
constructor arguments and exposes them as `ASSET()` / `VAULT()` with no setters,
so it can never be repointed: a USD, BTC and ETH tranche system each require
their own controller. Treat "the controller" as one deployment among several, and
never assume a chain has exactly one.

Currently indexed — Ethereum, USD:

| Component | Address |
|---|---|
| Main vault (yvUSD) | `0xDa87123895a043Ed3610155550177C54ce8ba49B` |
| Tranche controller | `0xF0145433E5289dd10712650dCd28333FA317eF36` |
| Hook | `0x776DEd3273440f1481d07B6CE916b5d5Fac170dC` |

Adding a deployment means one more `sources` entry under
`yearn/3/tranche/controller` in `config/abis.yaml`. Everything downstream is
keyed by controller address and scales without further changes: discovery, the
`tranche-system` series, the REST collection, and the per-tranche
`trancheController` default that routes assets and pps.

Tranches are **not** configured — the controller is a static source and Kong
discovers its tranches by walking `tranchesByPriority(index)`. At the time of
writing that yields three: `yvUSD-A` (Fixed), `yvUSD-B` (Levered) and `yvUSD-E`
(Equity), in priority order, where index `0` is most senior.

Reference: [yTranche contracts](https://github.com/Schlagonia/ytranche)

## Naming

Code uses functional names without the `y` prefix: `trancheController` and
`tranche`. "yTranche" is for documentation and user-facing text. A tranche's
`trancheType` is its implementation — `base` or `locked`, where locked adds
per-user cooldown and withdrawal windows — not its deployment nickname. A, B and
E are configuration, not protocol types.

## Indexed shape

```text
packages/ingest/abis/yearn/3/tranche/
  controller/     TrancheController — static source, snapshot + tranche-system series
  vault/          the tranche itself — `tranche` things, snapshot + pps/apy/tvl-c/tranche-accounting
  hook/           Hook read interface only; owns no thing and no snapshot
```

`controller` and `vault` are siblings rather than nested under a shared
`yearn/3/tranche` hook path on purpose: Kong's hook resolver applies a parent
path's hooks to all child paths, which would cross-wire the two.

### Things

The controller gets a `trancheController` thing, carrying `asset`, `mainVault`,
inception and the v3 / yearn flags. Nothing else would create one — the controller
is a configured source, not a discovered address — but it is how deployments are
enumerated without walking tranches, which matters for a controller whose tranches
aren't registered yet, and it puts the deployment on the dashboard's thing counts.
It deliberately carries no `reserveVault` default: that one is settable, so the
current value belongs to the snapshot rather than to defaults where it would go
stale.

Discovery then creates three things per tranche address — `tranche`, `vault` and
`strategy` — sharing one set of defaults:

```text
trancheController  priority  trancheType  asset  mainVault
inceptBlock  inceptTime  decimals  apiVersion  name  symbol
erc4626  v3  yearn  tranche  origin
```

The `vault` and `strategy` labels are what make a tranche visible to Kong's
existing vault surfaces. The `tranche` default is what stops the generic
`yearn/3/vault` and `yearn/3/strategy` paths from also claiming the address —
both filter on `tranche != true` — so every tranche has exactly one snapshot
owner.

### Snapshot naming: `hook` vs `hookState`

The automatic snapshot captures zero-argument reads, so for a tranche it stores
the Solidity `hook()` return value as the raw address in `snapshot.hook`.

Hook state is parameterized by tranche, so it can't come from the automatic
snapshot. The tranche snapshot hook reads the Hook at the same block with the
tranche as target and appends `hookState` to the snapshot's hook data — `open`,
`rateLimitWindow`, `depositLimit`, the deposit and withdrawal rate-limit
counters, and the derived `depositCap` / `withdrawCap`.

So: `hook` is an address, `hookState` is what that Hook reports for this tranche.
Nothing writes a second top-level `hook`, and the Hook itself gets no thing and
no snapshot. Account-scoped Hook state (`allowed`) and per-user cooldowns are not
indexed.

The controller's snapshot is enriched the same way: `hook.tranches` is an ordered
array with each tranche's `tranches()`, `liveAssets()` and `trancheCoverage()`
reads, taken at the automatic snapshot's block.

## Accounting semantics

- **`baselineAssets`** — principal plus accrued target plus realized excess.
- **`pendingExcess`** — profit assigned to a tranche but not yet realized through
  a strategy report. It is *not* part of live NAV.
- **`liveAssets`** — the authoritative asset balance for a tranche. It already
  excludes `pendingExcess`, so nothing downstream adds pending profit back.
- **`claim` / `covered`** — what a tranche claims, and how much of that claim the
  system's backing covers. Their ratio is *accounting* coverage.
- **`totalClaims` / `backingAssets`** — the same comparison system-wide: what the
  tranches collectively claim against the main vault's assets plus reserve.
- **Coverage is not withdrawal capacity.** What can be withdrawn right now is
  bounded by Hook limits and deliverable main-vault liquidity, and is reported
  separately as `depositCap` / `withdrawCap`.
- **Target rate is not realized yield.** `targetRatePerSecondWad` is what a
  tranche accrues toward; a tranche that absorbs a settlement loss has accrual
  paused.
- **Rate limits are fixed windows, not sliding lookbacks.** A bucket expires once
  `blockTime >= windowStart + rateLimitWindow`, at which point effective usage is
  zero. Counters are stored exactly as reported; deriving effective usage is left
  to consumers, which know the timestamp they are answering for.

### Assets, price per share and TVL

`abis/yearn/lib/assets` resolves a vault's authoritative asset balance from a
vault thing and a block: `totalAssets()` normally,
`trancheController.liveAssets(vault)` when the thing carries a
`trancheController`. The same module owns the shared price-per-share reader —
`pricePerShare()` normally, and for tranches:

```text
pricePerShare = authoritativeAssets × 10^decimals / totalSupply
```

falling back to `10^decimals` when supply is zero. `tvl-c`, `pps` and every apy
observation (current, weekly, monthly, inception) go through these two functions,
so a tranche and an ordinary vault are never measured by different rules.
Labels, components, pricing, sampling, annualization and storage are unchanged
for non-tranche vaults.

### No double counting

Tranche TVL is a claim on the main vault's backing, not additional protocol
assets. Adding main-vault TVL to tranche TVL would count the same underlying
assets more than once.

- Tranches emit `tvl-c` from `liveAssets(tranche)`.
- Tranches deliberately emit **no** legacy `tvl` label — that is the label naive
  aggregates sum.
- `pendingExcess` is excluded from live NAV and TVL.

## Timeseries labels

| Label | Address | Components |
|---|---|---|
| `tranche-accounting` | tranche | `baselineAssets`, `pendingExcess`, `liveAssets`, `claim`, `covered`, `coverageRatio`, `targetRatePerSecondWad`, `excessShareBps`, `accrualPaused` |
| `tranche-system` | controller | `totalClaims`, `vaultAssets`, `reserveAssets`, `backingAssets`, `coverageRatio` |

Both are daily, and every observation reads at a single historical block. Asset
amounts are normalized to the asset's decimals; `accrualPaused` is 1 or 0;
`coverageRatio` is null when there is no claim to cover, since no claim is not
evidence of full coverage. Tranches also carry the standard `pps`,
`apy-bwd-delta-pps` and `tvl-c` series. See [outputs](outputs.md).

## REST

`GET /api/rest/tranche/:chainId/controllers` lists every system on a chain, and
`GET /api/rest/tranche/:chainId/:controller` serves one as a single document.
`controllers` is a static route segment, so it resolves ahead of the sibling
member route and can never be confused for an address.

The new timeseries labels are exposed through the existing timeseries mechanism
as the `tranche-accounting` (addressed by tranche) and `tranche-system` (addressed
by controller) segments. There are no GraphQL fields for yTranche. See
[rest](rest.md).
