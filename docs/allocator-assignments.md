# Current allocator assignments

Kong #471 comes from treating factory deployments as active vault assignments. Kong now resolves `AddedNewVault`, `UpdateDebtAllocator`, `RemovedVault`, and vault `UpdateRoleManager` events from its own `evmlog` table. `packages/lib/allocators.ts` orders events by block, transaction, log, and ID, and uses the authoritative manager. Factory events remain deployment and ABI provenance.

## Indexing in Kong

- `config/manuals.yaml` registers the original Ethereum Yearn role manager, `0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41`, which predates the role manager factory. Its project metadata is supplied manually; its snapshot does not query a nonexistent factory project.
- `config/abis.yaml` adds the shared allocator factory, `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18`, on Ethereum, Polygon, Base and Katana. Deployment blocks were checked through archive RPC. Existing vault-bound sources, including Gnosis and Polygon, remain configured and are used for provenance.
- Initial and replacement Role Manager assignments enqueue allocator contracts as Kong `debtAllocator` things. Shared factory deployments do the same. Zero and no-code assignments remain visible in assignment logs but are not enqueued as contracts.
- The allocator ABI includes the historical vault-bound ratio events and shared `UpdateStrategyDebtRatio(vault,strategy,target,max,total)`. Kong's existing extractor stores every decoded ABI event, including shared ratio/control events, in `evmlog`. No additional indexing service is required.

## Projection and serving

The projection reads Kong logs through the RPC finalized block and verifies the resolved manager and allocator against contract state at that block. Its `sourceRevision` is `kong-evmlog-v1`. There is no separate chain allowlist: the configured Kong factory sources establish provenance on each chain. An unknown factory never substitutes an allocator address; an assigned custom contract stays visible with unsupported configuration. Shared getters receive `(vault,strategy)` and vault-bound getters receive `(strategy)`. Successful zero ratios remain zero.

Both GraphQL paths and REST use the saved `snapshot.hook.allocatorState`, exposing the same address, revision and ratios. `Allocator.address` is nullable for explicit clears and unavailable evidence. Address/ratio updates share the snapshot row lock and preserve accounting fields. `allocatorLastAcceptedBlock` survives unavailable projections and rejects lagging recovery. Failed refreshes retain the last validated state and ratios, exposing `stale: true`, `lastAttemptAt`, and `lastError`. The retained revision, block and `observedAt` still describe the last accepted observation. A successful refresh replaces that state and removes the stale metadata. Without a validated prior state, failures remain unavailable. Configuration failures retain ratios only for the same allocator, assignment and manager; a confirmed replacement or clear never inherits the previous allocator's ratios. The latest attempt time also rejects delayed successes that began before an outage.

## Chain coverage

Polygon's shared factory is indexed from block `63,167,288` (archive-verified deployment). Its current Yearn Role Manager, `0x2C4b68B2e3f03B3BD8804EB02fA22CD387E78B83`, is registered explicitly in `config/manuals.yaml` from its archive-verified deployment block `81,695,984`; its deployment did not emit a `NewProject` event from the configured factory. Backfill that manager and the shared allocator factory before refreshing existing vaults. A read-only check found the current allocator `0x10BC1f4f0dDD8027264E9F10FabE7A751614C207` on the seven listed Polygon Yearn V3 vaults.

Legacy Gnosis vaults are intentionally unsupported by this assignment API. Their controllers do not implement `getDebtAllocator(address)`, so factory deployments alone cannot establish an active assignment. The affected existing vaults are:

| Vault | Controller |
| --- | --- |
| `0xa21Cc1a4a239708690134bAeD3a1B93cAD55F625` (Curve EURe) | `0xFB4464a18d18f3FF439680BBbCE659dB2806A187` |
| `0x39B68451F05Aaa020611CF887a7338f0991fFd60` (AJNA EURe) | `0xF9b85835b023ADb7E7b3bD3529B5cd967920E8eC` |
| `0x5012C6bf79b3047ECFFf2F212DfFDA4d2128188f` (EURe) | `0x22eAe41c7Da367b9a15e942EB6227DF849Bb498C` |

These vaults expose unavailable assignment state and null allocator/ratios unless a previously validated observation is retained as stale. This is an intentional compatibility change from the old factory-based API, not a Gnosis chain allowlist exclusion. Factory indexing remains configured; future Gnosis vaults with valid manager assignment evidence can resolve normally. A separate legacy role-grant compatibility path is outside this PR.

## Adoption

1. Run Kong's normal config/manual discovery and event fanout for the newly configured role managers and shared factories, then their discovered allocators. Let those sources finish indexing before materializing vault projections.
2. Replay stored Role Manager events through Kong's existing event hooks when discovering historical assignments on managers already indexed. For an allocator already covered by old ABI strides, schedule a fresh RPC extraction over the missing shared-event range: Kong's `replay` mode reads stored logs and cannot recover events absent from `evmlog`. Preserve unrelated sources and strides.
3. Check the relevant `UpdateDebtAllocator`, factory deployment, and shared ratio rows in `evmlog`. For yvUSDC-1, the replacement is at block `20,987,762`, transaction index `163`, log index `422`, assigning `0x1e9eB053228B1156831759401dE0E115356b8671` to `0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204`.
4. From the Kong root, run `bun --env-file=.env packages/ingest/abis/yearn/lib/allocators/refresh.ts --chain=1 --vault=0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204`. Omit `--vault` to check all stored V3 vaults on the selected chain. The dry run reads local logs and RPC without updating snapshots. Repeat with `--write` after checking the result.
5. Refresh the existing REST cache using `packages/web/app/api/rest/refresh-vaults.cli.ts`, then compare both GraphQL fields and REST's saved revision. Normal cache freshness still applies.

Refresh output reports `outcome: "dry_run"` and `written: false` for a read-only candidate. With `--write`, reported fields describe the committed projection: accepted candidates are `applied` with `written: true`; rejected candidates are `skipped` with `written: false` and report the retained state. Saving stale metadata reports `stale` with `written: true`, while retaining the accepted address and revision.

No database migration is required. The refresh command exits nonzero on required evidence failures, including when `--write` saves stale metadata on the retained observation.

Production discovery/backfill and snapshot/cache activation are operational steps; local fixture tests do not certify their completion. Full allocation-history APIs remain outside this PR.

## Verification

Tests cover local SQL assignment resolution, real ABI decoding and persistence through Kong's loader, shared ratio event storage, initial/replacement discovery, legacy manager metadata, Gnosis/Polygon factory configuration, custom/no-code assignments, two vaults sharing an allocator, zero ratios, explicit clears, atomic updates, and refresh reporting. Synthetic fixtures use the #471 addresses and event boundary without claiming a production replay. A separate local check loaded Polygon's real assignment transaction `0x71455263e2a5440fd9a9e1e4d155f237c20f703d6205883df5cedceccee45bb6` and shared deployment into Kong: at block `86,228,011`, USDC-1 resolved `0x10BC1f4f0dDD8027264E9F10FabE7A751614C207` with target/max ratios `10000/10000` for Fluid and `0/0` for the two other queued strategies. This verifies native projection against chain evidence, not production backfill.
