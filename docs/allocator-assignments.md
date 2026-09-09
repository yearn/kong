# Current allocator assignments

Kong #471 comes from treating factory deployments as active vault assignments. Kong now resolves `AddedNewVault`, `UpdateDebtAllocator`, `RemovedVault`, and vault `UpdateRoleManager` events from its own `evmlog` table. `packages/lib/allocators.ts` orders events by block, transaction, log, and ID, and uses the authoritative manager. Factory events remain deployment and ABI provenance.

## Indexing in Kong

- `config/manuals.yaml` registers the original Ethereum Yearn role manager, `0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41`, which predates the role manager factory. Its project metadata is supplied manually; its snapshot does not query a nonexistent factory project.
- `config/abis.yaml` adds the shared allocator factory, `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18`, on Ethereum, Base and Katana. Deployment blocks were checked through archive RPC. Existing vault-bound sources, including Gnosis and Polygon, remain configured and are used for provenance.
- Initial and replacement Role Manager assignments enqueue allocator contracts as Kong `debtAllocator` things. Shared factory deployments do the same. Zero and no-code assignments remain visible in assignment logs but are not enqueued as contracts.
- The allocator ABI includes the historical vault-bound ratio events and shared `UpdateStrategyDebtRatio(vault,strategy,target,max,total)`. Kong's existing extractor stores every decoded ABI event, including shared ratio/control events, in `evmlog`. No additional indexing service is required.

## Projection and serving

The projection reads Kong logs through the RPC finalized block and verifies the resolved manager and allocator against contract state at that block. Its `sourceRevision` is `kong-evmlog-v1`. There is no separate chain allowlist: the configured Kong factory sources establish provenance on each chain. An unknown factory never substitutes an allocator address; an assigned custom contract stays visible with unsupported configuration. Shared getters receive `(vault,strategy)` and vault-bound getters receive `(strategy)`. Successful zero ratios remain zero.

Both GraphQL paths and REST use the saved `snapshot.hook.allocatorState`, exposing the same address, revision and ratios. `Allocator.address` is nullable for explicit clears and unavailable evidence. Address/ratio updates share the snapshot row lock and preserve accounting fields. `allocatorLastAcceptedBlock` survives unavailable projections and rejects lagging recovery. Required evidence failures currently produce unavailable state; changing the outage/staleness policy is a separate follow-up.

## Adoption

1. Run Kong's normal config/manual discovery and event fanout for the newly configured role manager and shared factories, then their discovered allocators. Let those sources finish indexing before materializing vault projections.
2. Replay stored Role Manager events through Kong's existing event hooks when discovering historical assignments on managers already indexed. For an allocator already covered by old ABI strides, schedule a fresh RPC extraction over the missing shared-event range: Kong's `replay` mode reads stored logs and cannot recover events absent from `evmlog`. Preserve unrelated sources and strides.
3. Check the relevant `UpdateDebtAllocator`, factory deployment, and shared ratio rows in `evmlog`. For yvUSDC-1, the replacement is at block `20,987,762`, transaction index `163`, log index `422`, assigning `0x1e9eB053228B1156831759401dE0E115356b8671` to `0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204`.
4. From the Kong root, run `bun --env-file=.env packages/ingest/refresh-allocators.ts --chain=1 --vault=0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204`. Omit `--vault` to check all stored V3 vaults on the selected chain. The dry run reads local logs and RPC without updating snapshots. Repeat with `--write` after checking the result.
5. Refresh the existing REST cache using `packages/web/app/api/rest/refresh-vaults.cli.ts`, then compare both GraphQL fields and REST's saved revision. Normal cache freshness still applies.

Refresh output reports `outcome: "dry_run"` and `written: false` for a read-only candidate. With `--write`, reported fields describe the committed projection: accepted candidates are `applied` with `written: true`; rejected candidates are `skipped` with `written: false` and report the retained state.

No database migration is required. Production discovery/backfill and snapshot/cache activation are operational steps; local fixture tests do not certify their completion. Full allocation-history APIs remain outside this PR.

## Verification

Tests cover local SQL assignment resolution, real ABI decoding and persistence through Kong's loader, shared ratio event storage, initial/replacement discovery, legacy manager metadata, Gnosis/Polygon factory configuration, custom/no-code assignments, two vaults sharing an allocator, zero ratios, explicit clears, atomic updates, and refresh reporting. Synthetic fixtures use the #471 addresses and event boundary without claiming a production replay.
