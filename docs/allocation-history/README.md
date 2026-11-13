# Vault allocation history

> Design draft: this README describes the intended finished feature. It does not describe the current Kong deployment.

Kong's allocation-history REST API provides data for showing how Yearn V3 vaults distribute capital across strategies over time. Frontends use this data to render allocation charts, show changes between chart points, and explain each rebalancing action.

The history covers both automated Debt Allocator execution and allocations chosen by administrators. Debt Optimizer proposals supply target allocations and expected APR information when they can be linked to on-chain activity.

Powerglove is the reference consumer. Websites receive prepared chart data; Kong handles historical reconstruction, accounting, and execution classification in a background refresh job.

The [yvUSDC-1 real-data sample pack](samples/yvusdc-1/README.md) contains captured prototype responses for reviewing the data shape and building UI mocks. Its reading guide documents provenance, limitations, and differences from this intended contract.

The [high-level implementation spec](high-level-spec.md) describes the changes to Kong and their delivery order.

## What you can show

- How much capital each strategy held after a rebalancing action, including capital held idle in the vault.
- How allocations changed between successive actions and through the latest published snapshot.
- Whether an action followed an allocator recommendation, used a manually chosen amount, or lacks enough evidence to decide.
- Which optimizer policy governed an action and its expected APR change, when available.
- The transactions, allocation targets, and before/after states behind an individual action.

For example, a keeper may move capital from strategy A to strategy B to follow allocator targets. An administrator may later move capital through the same allocator using a different amount. Both appear as strategy reallocations, with different execution information. Deposits, withdrawals, and strategy reports between those actions remain part of the accounting that connects the chart points.

## Read the history

```http
GET /api/rest/views/allocation-history/:chainId/:address?projection=chart
```

For yvUSDC-1 on Ethereum:

```http
GET /api/rest/views/allocation-history/1/0xbe53a109b494e5c9f97b9cd39fe969be68bf6204?projection=chart&limit=25&direction=desc
```

| Parameter | Behavior |
| --- | --- |
| `chainId`, `address` | Select the vault. |
| `projection=chart` | Select the compact chart response. |
| `limit` | Number of rebalancing entries; defaults to 25, maximum 100. |
| `direction` | `desc` for newest first, or `asc` for oldest first. Defaults to `desc`. |
| `cursor` | Continue from `pagination.nextCursor`, preserving the other query parameters. |

The response contains:

| Field | Contents |
| --- | --- |
| `vault` | Vault identity and underlying asset metadata, including decimals for displaying amounts. |
| `runId`, `generatedAt` | The published refresh run and when it was generated. |
| `dataQuality` | Coverage and evidence limitations for the published history. |
| `strategies` | Strategy addresses and display names used by this page. |
| `entries` | Strategy reallocations, each with its resulting allocation, execution information, optional expected APR impact, and an interval connecting it to the previous chart point. |
| `currentSnapshot` | Allocation at the run's latest safe block, with the interval connecting it to the history. Returned on the first page. |
| `boundaryStates` | States needed to draw intervals whose starting entry falls outside this page. |
| `pagination.nextCursor` | The next page, or `null` at the end. |

Amounts are integer strings in the underlying asset's smallest unit. Each state contains `totalAssets`, `totalIdle`, and the `currentDebt` assigned to each strategy. Clients derive display amounts and percentages from these values. Timestamps are Unix seconds in UTC.

Follow an entry's `detailsHref` to inspect its complete action:

```http
GET /api/rest/views/allocation-history/:chainId/:address/entries/:entryId?runId=:runId
```

Details include the action's before/after states, contributing transactions and operations, execution evidence, related policy, and interval reconciliation. The detail link selects the same published run as the chart. Both endpoints read prepared Kong data, with no upstream or RPC calls at request time.

## How to read the chart

The chart is an event-based history. Each historical point represents a strategy reallocation, which may group several related transactions. Kong groups transactions only when execution evidence and state continuity support treating them as one action.

Deposits, withdrawals, reports, pure idle movements, and configuration-only changes do not create standalone points in this compact view. They still contribute to the states and intervals. The chart therefore shows selected allocation checkpoints rather than a daily balance series or every intermediate balance change.

An interval connects the allocation after one visible action to the allocation after the next. It includes activity between them as well as the next action. This differs from the action's own before/after change, available in its details.

Interval flows account for strategies, idle capital, deposits and withdrawals, and accounting gains or losses. Derived strategy-to-strategy flows describe how the balances changed; they do not assert a direct token transfer between strategy contracts. Any unexplained amount remains explicitly unattributed.

The current snapshot ends the chart at its recorded block and timestamp. `generatedAt` describes when Kong built the response; it is not the time of the underlying allocation state.

## Automation, targets, and optimizer policies

An entry separates three questions:

| Field | Question answered |
| --- | --- |
| `execution.automation` | Did the amount follow an automatic recommendation, or was it chosen manually? |
| `execution.mechanism` | Was execution through an allocator keeper, a direct vault role, a governance Safe, or another identified path? |
| `execution.targetStatus` | Did execution match the allocator recommendation, override it, or lack the evidence needed to compare? |

The transaction sender alone does not establish these answers. Kong uses the call path, historical permissions, and allocator configuration. Unresolved attribution remains unknown, and grouped actions can contain mixed execution.

A Debt Optimizer proposal describes a target policy. Publishing a proposal does not prove that capital moved. One applied policy can govern several later keeper actions. Policy links distinguish an observed application from a match inferred from historical configuration.

`expectedAprImpact` describes the optimizer's proposal-level estimate. It is not a measured return or a realized APR improvement from the individual action. Missing optimizer data leaves executed history available with the enrichment marked unavailable.

## How Kong refreshes the data

```text
Stored events + previous published run
                  |
                  v
       Select a safe processing range
                  |
                  v
 Resolve strategies and allocator assignments
                  |
                  v
  Fetch or reuse historical RPC evidence
                  |
                  v
     Build and classify allocation actions <--- Optional optimizer policies
                  |
                  v
     Build intervals and validate accounting
                  |
          +-------+-------+
          |               |
        Pass             Fail
          |               |
          v               v
 Publish complete run   Record failure;
          |             retain previous run
          v
     REST reads
```

The refresh job selects a block supported by both chain finality and event coverage. It resolves the strategies and allocator assigned at each historical position, reads vault accounting and relevant execution evidence, and builds the actions and chart intervals.

Historical states use explicit block boundaries. Block-end reads include all activity in that block; transaction evidence explains the contributing operations without claiming transaction-exact snapshots from block-level reads.

Kong checks every published state:

```text
sum(strategy currentDebt) = totalDebt
totalDebt + totalIdle = totalAssets
```

It also reconciles opening balances, inflows, outflows, and closing balances for every strategy and idle node in each interval. A balanced interval may still contain unattributed changes; balance and attribution are reported separately.

### Backfill and recurring refresh

An initial backfill constructs history across the supported range. Scheduled refreshes extend it, reusing unchanged historical evidence and revisiting the affected history when events or policy records arrive late or are corrected. A refresh boundary does not split an otherwise supported action into two entries.

Both modes use the same processing rules. A full rebuild and an incremental refresh produce equivalent history for the same safe block and source revisions.

Each vault has one refresh in progress at a time. Kong builds and validates a new run before publishing it. Failed or interrupted work leaves the previous successful run available. Job status records progress, the processed range, and failures independently of the published response.

Pagination and detail links remain tied to their original run while newer runs are published. Kong retains older runs for the supported cursor lifetime; expired references require restarting pagination rather than silently switching to newer data.

## Inputs and ownership

The refresh job consumes events already available through Kong's event-data layer. Event acquisition and the migration to Envio are separate work, tracked in [Kong #402](https://github.com/yearn/kong/issues/402).

| Input | Purpose |
| --- | --- |
| Vault debt, strategy lifecycle, configuration, deposit, withdrawal, and report events | Reconstruct changes and explain activity between chart points. |
| Role Manager membership and allocator-assignment events | Resolve which allocator was assigned to the vault at each point. |
| Allocator ratio, keeper, and governance events | Recover target configuration and execution context. |
| Factory deployment evidence | Identify supported contract families and their configuration interfaces. |
| Event ordering, block identities, and coverage information | Process history consistently and identify incomplete ranges. |
| Historical RPC state and transaction evidence | Establish balances, permissions, and execution paths. |
| Optional optimizer policy records | Attach targets, explanations, and expected APR information. |

Kong owns state reconstruction, grouping, classification, accounting validation, storage, and REST presentation. This feature does not require its own Envio client or a new GraphQL API.

Allocator assignment is distinct from factory deployment. Shared allocators can serve several vaults, and assignments can change. Kong preserves an observed assigned address even when its configuration interface is unsupported; it does not substitute the previous allocator's targets.

## Coverage and availability

The initial supported scope is Yearn V3 multi-strategy vaults on Ethereum, Base, and Katana. Vaults come from Kong's vault inventory, with publication enabled per vault when its required historical coverage and accounting checks pass.

Incomplete required event coverage or failed accounting reads prevent a new production run from being published. Missing optional policy or execution enrichment is reported as unavailable rather than guessed. Unknown values remain distinct from legitimate zero balances or ratios.

A vault with no published history returns `404`; invalid parameters return `400`. A valid published history with no strategy reallocations returns an empty `entries` array and its available current snapshot. When a refresh fails, the previous published run keeps its original timestamps so clients can assess freshness.

Provisional fixtures may be used for UI review, with their provenance and limitations preserved. They are not evidence that a vault's production history is complete.
