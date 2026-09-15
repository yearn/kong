# yvUSDC-1 real-data sample pack

This pack contains real responses from the running `yearn-allocation-service` prototype: two consecutive chart pages and five representative action-detail responses. Use them to review the API shape and render the allocation-history UI with fixed data.

The responses are **provisional**, generated on **September 10, 2026 at 19:45:44 UTC**, and captured on **September 15, 2026**. They describe stored historical observations, not current vault balances. The JSON has been indented for readability; no response fields or values have been added, removed, or changed.

## Start here

1. Load [chart-page-1.json](chart-page-1.json) for the initial chart: 25 rebalancing entries, strategy names, boundary states, and the current snapshot for this run.
2. Load [chart-page-2.json](chart-page-2.json) when the UI requests the first page's `pagination.nextCursor`. This is the actual next API response, with 25 older entries and `currentSnapshot: null`.
3. Use the detail files below for the selected entries' `detailsHref` requests. Match them using the paths in [manifest.json](manifest.json).

The second page still has a next cursor. The pack intentionally stops at 50 entries; it does not represent the end of the vault's history. Fixture loaders should identify that sample boundary rather than changing the response to imply that history is complete.

## Representative actions

All five examples occur on page 1. Array indices below are zero-based.

| Example | Chart location | Detail response | What it demonstrates |
| --- | --- | --- | --- |
| Automatic keeper action | `entries[0]` | [detail-automatic.json](detail-automatic.json) | Two transactions grouped into one action, with an automatic recommendation match and an available optimizer APR estimate. |
| Manual allocator override | `entries[8]` | [detail-manual-override.json](detail-manual-override.json) | Execution uses the allocator keeper path, while the amount is classified as manually chosen and the target as overridden. |
| Governance Safe action | `entries[11]` | [detail-governance-safe.json](detail-governance-safe.json) | Manual governance execution with no available matched optimizer APR estimate. |
| Unknown execution attribution | `entries[13]` | [detail-unknown-execution.json](detail-unknown-execution.json) | A known allocator keeper path with unknown automation and unavailable target comparison. The policy estimate remains independently available. |
| Partially attributed interval | `entries[19]` | [detail-unattributed-interval.json](detail-unattributed-interval.json) | Exact balance reconciliation with `attributionStatus: "partial"` and `unattributedAmount: "2"`. Two raw USDC units equal 0.000002 USDC. |

These are the producer's classifications, preserved as returned. This capture did not independently replay transactions to establish their accuracy.

## Reading amounts and intervals

- The vault is Ethereum yvUSDC-1: `0xbe53a109b494e5c9f97b9cd39fe969be68bf6204`.
- Its underlying asset is USDC, with **6 decimals**, as recorded in each detail response's `vault.assetDecimals`. Keep amounts as integer strings or arbitrary-precision integers until display formatting.
- Chart allocations contain each strategy's `currentDebt`, together with vault `totalAssets` and `totalIdle`. Strategy names are in the page-level `strategies` dictionary.
- `boundaryStates` supplies the opening state for intervals starting outside the page. The page-1 boundary matches the corresponding entry on page 2.
- An entry's interval runs from the previous visible action's after-state to this entry's after-state. It includes intervening deposits, withdrawals, reports, and other activity.
- The detail response's `entry.before` and `entry.after` describe the action itself. They serve a different purpose from `interval.startState` and `interval.endState`.
- Flow attribution distinguishes observed events, debt-update-derived flows, and residual balancing amounts. Retain those distinctions when presenting explanations.
- `expectedAprImpact` contains proposal-level estimates in basis points. For example, `296` means 2.96% APR; a delta of `3` means 0.03 percentage points. It is not measured realized yield.

## Provenance and quality

| Item | Value |
| --- | --- |
| Source | Running local `yearn-allocation-service` prototype |
| Schema | `schemaVersion: 2` |
| Materialization run | `89`, identified by the captured detail links |
| Generated | September 10, 2026, 19:45:44 UTC |
| Current snapshot block | `25949082` |
| Captured | September 15, 2026; exact timestamp in the manifest |
| Coverage status | `provisional`, preserved in every response |
| Sample extent | 50 chart entries across two pages; five selected details; more history exists |
| Running build revision | Unavailable: the API does not expose it |

The responses report missing Envio coverage metadata, accounting checkpoints, and checkpoint-failure records. They also report that provisional state reconstruction starts at the first indexed transition block, `19419991`. The existence of earlier complete history is not established by these samples.

Detail states retain `unallocatedBps: null` when the prototype lacks its required indexed checkpoint evidence, even where RPC-derived `totalIdle` is present. Preserve both values and their provenance. A null ratio does not mean zero idle capital.

[manifest.json](manifest.json) records the exact relative request paths, capture time, source limitations, run identity, scenario locations, response-body hashes, and hashes of the formatted fixture files. Source hostnames and credentials are not needed to use the pack.

## Differences from the finished-product README

These are samples of the existing prototype, not fabricated responses for the proposed Kong contract.

| Area | Captured prototype | Intended README |
| --- | --- | --- |
| Top-level run identity | No top-level `runId`; the run is selected by detail links and pagination cursors. The manifest records it separately. | An explicit top-level `runId`. |
| Chart vault metadata | Chart pages include chain, address, and name. Asset metadata and decimals are in detail responses. | Asset metadata, including decimals, is available in the chart response's `vault`. |
| Coverage information | `dataQuality` contains provisional certification and limitation strings. | The published response describes its supported coverage and evidence limitations. Exact additional fields belong in the specification. |
| Checkpoint dependency | Detail-only unallocated-ratio fields retain the prototype's Envio-checkpoint requirement. | Kong owns accounting reconstruction and validation without an Envio-specific checkpoint dependency. |

The compact allocations, intervals, execution fields, expected APR fields, and detail links are the working reference. A fixture-based UI can obtain USDC decimals from the captured detail metadata while the final chart contract is agreed. It should not silently add proposed fields to the source fixtures.

## Validation performed

[validation.json](validation.json) records the checks and their limits. The capture verified:

- Every response belongs to the same vault and generated materialization; every chart detail link selects run `89`.
- Page 2 was fetched using page 1's returned cursor; entry IDs do not overlap, and the shared boundary state agrees.
- All checked states satisfy `sum(currentDebt) + totalIdle = totalAssets`; detail states also reconcile `totalDebt`.
- All 51 chart intervals, including the current-snapshot interval, and all five selected detail intervals balance independently for every idle and strategy node.
- Unattributed flow amounts match their reported totals. Full detail residual equations balance.
- The selected detail states and execution fields agree with their chart entries.
- Each saved response has a SHA-256 checksum in the manifest.

These checks establish internal consistency of the captured data. They do not certify event completeness or exercise a live refresh. Empty-history, expired-cursor, and error responses are outside this real-data pack.
