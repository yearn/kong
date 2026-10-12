# Approximate aggregate Yearn TVL

## Summary

Expose an approximate aggregate TVL for Yearn vaults using the TVLs already stored in Kong's snapshots. A refresh script removes identifiable double counting, writes the result to Redis, and a REST endpoint serves the cached result.

```text
Snapshots → refresh script → deduplication → Redis → REST endpoint
```

The priority is a useful approximation. This design does not require synchronized on-chain valuation or complete resolution of every nested holding.

The implementation exposes the latest cached estimate. Historical aggregate TVL is outside its scope.

## Vault selection and TVL source

- Include `thing.label = 'vault'` using Kong's existing Yearn filter: merged `yearn = true` **or** `origin = 'yearn'`.
- Reuse the classification and merge semantics in [`vaultFilters.ts`](../packages/web/lib/vaultFilters.ts) and [`mergeSnapshot.ts`](../packages/web/lib/mergeSnapshot.ts).
- Identify each vault by chain ID and lowercase address. Count contracts labeled both vault and strategy only once.
- Include hidden and retired vaults if they still hold assets.
- Read gross USD TVL from `snapshot.hook.tvl.close`, which supplies the current [REST vault listing](../packages/web/app/api/rest/list/db.ts).
- Omit vaults whose gross TVL is missing, negative, or non-finite. They cannot serve as included deduction targets until a usable TVL is available.
- Use the latest available snapshots. The TVL and debt values can represent different observation times, so the result is an approximation.

## Deduplication rules

For each included vault:

```text
contribution = gross snapshot TVL − identified overlapping value
aggregate TVL = sum(contributions)
```

Deduct an overlapping position only when its target vault is also included in the aggregate. Apply the following rules in order.

### 1. Vaults whose underlying asset is another included vault

Match the parent's enriched asset address against included vaults on the same chain.

When the parent's assets are denominated in that child's shares, deduct the parent's full TVL. Keep both vaults in the response, with the wrapper contributing zero.

Skip additional deductions from that parent: its value has already been removed.

### 2. Allocations directly into another included vault

For remaining parents, match `hook.debts[].strategy` against included vault addresses on the same chain.

Subtract the corresponding allocation:

- V3: `currentDebtUsd`.
- V2: `totalDebtUsd`, where the strategy address is itself an included vault.

Keep the child's full TVL. This retains deposits made directly into the child by other users.

Yearn V3 includes recorded strategy debt in its total assets, making that debt the relevant parent-side amount to remove. See the [VaultV3 contract](https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy).

Kong already exposes these debt fields through its [V3 vault snapshot hook](../packages/ingest/abis/yearn/3/vault/snapshot/hook.ts) and [V2 vault snapshot hook](../packages/ingest/abis/yearn/2/vault/snapshot/hook.ts).

Example:

| Component | USD |
|---|---:|
| A's TVL, including $80 allocated to B | 100 |
| B's TVL, including outside deposits | 150 |
| Deduction for A's allocation to B | −80 |
| **Aggregate** | **170** |

Dropping B entirely would discard its outside deposits. Subtracting all of A's strategy debt would also be wrong if some strategies invest outside the included vault set.

### 3. Indirect holdings through strategies

Where an intermediary strategy holds shares of another included vault, enrich its snapshot with the target vault and the overlapping USD value attributable to the parent.

The refresh script consumes those exposures and deducts them once. For shared strategies, use only the parent's attributable position.

Stop tracing a position when it reaches an included vault: that vault's own deductions handle subsequent nesting. Do not subtract the same position through both debt and enriched holdings.

Existing strategy relationships alone do not establish these hidden holdings. Inspect representative snapshots and strategy accounting before adding strategy-specific enrichment. Until an exposure can be identified, leave it undeducted.

### Approximation defaults

- Cap total deductions at the parent's gross TVL.
- Leave unresolved holdings undeducted; they can cause residual double counting.
- Do not subtract all strategy debt, all delegated assets, or exclude a child merely because another vault invests in it.
- Use `hook.debts` as the source of direct allocations; do not count mirrored `composition` entries again.
- Different snapshot observation times can affect the estimate. Refresh time is the time the aggregate was calculated, not a common on-chain valuation time.

The current [TVL computation](../packages/ingest/abis/yearn/lib/tvl.ts) includes total assets and reports delegated assets separately. The delegated component is not a general-purpose deduction: it does not identify which target vaults are included in this aggregate.

## Endpoint and refresh

### Public endpoint

Add `GET /api/rest/tvl`, with optional `chainId`.

Return:

- `tvl`: the approximate aggregate after deductions.
- `grossTvl`: the sum before deductions.
- `deduplicatedTvl`: the total USD amount deducted.
- `updatedAt`: the refresh timestamp.
- Per-chain totals.
- Per-vault gross TVL, deductions, and contribution, including the target and reason for each deduction.

The endpoint reads a cached payload using existing REST cache and CORS conventions. It performs no RPC calls or database aggregation on requests.

### Refresh script

Add a dedicated refresh module and CLI under `packages/web/app/api/rest/tvl/`.

1. Batch-read vault snapshots and relevant strategy snapshots from Postgres.
2. Select the included Yearn vaults and build a lookup by chain ID and normalized address.
3. Sum their gross snapshot TVLs.
4. Apply the ordered deduplication rules and record each deduction.
5. Calculate per-vault contributions, per-chain totals, and the overall aggregate.
6. Write one aggregate payload to Redis.

Keep all aggregation and deduplication logic in this refresh module. Ingest enrichment supplies missing exposure facts; it does not calculate the aggregate.

Follow the existing [refresh module](../packages/web/app/api/rest/refresh-vaults.ts), [Redis cache helpers](../packages/web/app/api/rest/cache.ts), and [authenticated cron handler](../packages/web/app/api/cron/handler.ts).

Add an authenticated refresh cron running every 30 minutes. Preserve the previous cached payload if refresh fails.

The refresh runs through `/api/cron/tvl-refresh` on Vercel. It uses `CRON_SECRET`
and optionally sends a heartbeat to `UPTIME_KUMA_PUSH_URL_TVL_REFRESH`.

To populate the cache locally, run from the repository root:

```bash
bun packages/web/app/api/rest/tvl/refresh.cli.ts
```

The response has `chains` and `vaults` arrays. An optional `chainId` filters both
arrays and returns totals for that chain, while preserving `updatedAt`. A chain
with no included vaults returns zero totals and empty arrays. Before the first
successful refresh, the endpoint returns 404.

Indirect exposure enrichment is opt-in. A relevant strategy snapshot can publish
`hook.aggregateTvlExposures` entries with `parentChainId`, `parentVaultAddress`,
`targetChainId`, `targetVaultAddress`, and `attributableUsd`. Each entry describes
one parent's position in one target through that strategy. Existing strategy
hooks do not produce these facts; unresolved holdings remain undeducted.

## Validation

During implementation, cover:

- Independent vaults: aggregate equals the gross sum.
- Partial allocations with outside deposits: the example above produces $170.
- Vault-share wrappers: the wrapper contributes zero, without an additional debt deduction.
- Multiple parents sharing a child: subtract each parent's allocation once and retain the child's full TVL.
- Three-level nesting: deduct each immediate overlap once, without an additional transitive deduction.
- Indirect strategy holdings: deduct only the exposure attributable to the parent.
- Duplicate vault and strategy labels: count each chain/address once.

Verify that per-vault contributions sum to per-chain totals, per-chain totals sum to the aggregate, and `grossTvl - deduplicatedTvl = tvl`.

Inspect representative snapshot records before adding strategy-specific enrichment. Unresolved positions remain part of the approximation rather than blocking publication.
