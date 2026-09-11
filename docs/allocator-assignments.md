# Current allocator assignments

Kong #471 comes from treating factory deployments as active vault assignments. Kong now resolves `AddedNewVault`, `UpdateDebtAllocator`, `RemovedVault`, and vault `UpdateRoleManager` events from its own `evmlog` table. `packages/lib/allocators.ts` orders events by block, transaction, log, and ID, and uses the authoritative manager. Factory events remain deployment and ABI provenance.

## Indexing in Kong

- `config/manuals.yaml` registers the original Ethereum Yearn role manager, `0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41`, which predates the role manager factory. Its project metadata is supplied manually; its snapshot does not query a nonexistent factory project.
- `config/abis.yaml` adds the shared allocator factory, `0x03D43dF6FF894C848fC6F1A0a7E8a539Ef9A4C18`, on Ethereum, Polygon, Base and Katana. Deployment blocks were checked through archive RPC. Existing vault-bound sources, including Gnosis and Polygon, remain configured and are used for provenance.
- Initial and replacement Role Manager assignments enqueue allocator contracts as Kong `debtAllocator` things. Shared factory deployments do the same. Zero and no-code assignments remain visible in assignment logs but are not enqueued as contracts.
- The allocator ABI includes the historical vault-bound ratio events and shared `UpdateStrategyDebtRatio(vault,strategy,target,max,total)`. Kong's existing extractor stores every decoded ABI event, including shared ratio/control events, in `evmlog`. No additional indexing service is required.

## Projection and serving

The projection reads Kong logs through the RPC finalized block and verifies the resolved manager and allocator against contract state at that block. Its `sourceRevision` is `kong-evmlog-v1`. There is no separate chain allowlist: the configured Kong factory sources establish provenance on each chain. An unknown factory never substitutes an allocator address; an assigned custom contract stays visible with unsupported configuration. Shared getters receive `(vault,strategy)` and vault-bound getters receive `(strategy)`. Successful zero ratios remain zero.

Both GraphQL paths and REST use the saved `snapshot.hook.allocatorState`, exposing the same address, revision and ratios. `Allocator.address` is nullable for explicit clears and unavailable evidence. Address/ratio updates share the snapshot row lock and preserve accounting fields. `allocatorLastAcceptedBlock` survives unavailable projections and rejects lagging recovery. Failed refreshes retain the last validated state and ratios, exposing `stale: true`, `lastAttemptAt`, and `lastError`. The retained revision, block and `observedAt` still describe the last accepted observation. A successful refresh replaces that state and removes the stale metadata. Without a validated prior state, failures remain unavailable. Configuration failures retain ratios only for the same allocator, assignment and manager; a confirmed replacement or clear never inherits the previous allocator's ratios. The latest attempt time also rejects delayed successes that began before an outage. A successful finalized-block read of a changed role manager invalidates the old assignment even when the new manager has no indexed assignments or subsequent database reads fail. Its block becomes the recovery floor, preventing delayed jobs from restoring the old manager's allocator.

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

This is an operator-run, post-merge rollout. Deploy ingest first and promote the
new web/API build only after the backfill and materialization checks below.
Merging this PR does not run these steps. Use the target deployment's existing
Postgres, Redis and archive RPC settings; all commands below run from the Kong
repository root with that environment in `.env`.

**Accepted interim risk:** before backfill and materialization complete, a
routine snapshot hook can save unavailable state and clear a legacy allocator.
Clients may therefore see null allocator/ratios even while the old web build is
still running. Deploying ingest alone does not end this window. It ends for each
supported vault after its evidence is indexed, its new state is successfully
written, and the serving caches are refreshed. Legacy Gnosis controllers listed
above remain intentionally unavailable; they are not a temporary backfill gap.
There is no legacy factory fallback or activation flag in this PR.

1. **Deploy the new ingest code and configuration; hold web promotion.** Use the
   normal service deployment procedure. Confirm the running version includes
   both manual managers and all shared factory sources. Check whether local
   `config/manuals.local.yaml` or `config/abis.local.yaml` overrides shadow the
   checked-in configuration. The direct managers are Ethereum `0xb3bd…9a41`
   from block `19,388,998` and Polygon `0x2C4b…8B83` from `81,695,984`.
   The shared factory starts at `20,966,833` / `63,167,288` / `21,262,021` /
   `2,237,097` on chains `1` / `137` / `8453` / `747474`, respectively.

2. **Run discovery and fanout, allowing each pass to drain.** Launch:

   ```bash
   bun --env-file=.env packages/terminal/index.ts
   ```

   Select **Ingest → extract manauls** (the existing menu spelling) and wait for
   the resulting `load.thing` jobs. Then select **Ingest → fanout abis**. Repeat
   normal fanout after each pass finishes so newly discovered managers and
   allocator things are picked up. One pass is not sufficient for all discovery
   stages. A busy fanout is skipped; check for `ABI_FANOUT_SKIPPED_BUSY` and
   retry after the active/queued ingestion work drains. Resolve failed jobs.

3. **Complete and verify native event backfill.** Let manager, factory, vault
   and discovered allocator sources catch up to a chosen finalized block on
   each chain. Check the covered ranges in `evmlog_strides`, including gaps;
   the existence of a thing or one log is not proof of complete coverage.

   For managers already indexed, **Ingest → fanout replays** reruns hooks over
   stored logs to discover historical assigned contracts. Follow it with normal
   ABI fanout for those contracts. Stored-log replay cannot fetch missing events.
   For allocators whose old ABI strides omit shared ratio events, enqueue fresh
   `extract.evmlog` jobs over the affected ranges with `abiPath:
   "yearn/3/debtAllocator"`, the selected `chainId` and allocator `address`,
   inclusive `from`/`to` blocks, and `replay: false`. Split ranges into the normal
   provider-sized chunks (Polygon: 3,000 blocks; Gnosis: 5,000; otherwise the
   configured `LOG_STRIDE`, default 10,000). Use fresh job IDs so retained
   completed jobs do not suppress extraction. Preserve unrelated strides and logs.

   To enqueue a fresh extraction directly, this example re-fetches **one block**
   for the Ethereum reference allocator. Change the address/chain/range for each
   affected chunk; this example alone is not the full backfill. Omitting `jobId`
   lets BullMQ assign a fresh ID.

   ```bash
   bun --env-file=.env -e '
   import "lib/global"
   import { mq } from "lib"
   try {
     await mq.add(mq.job.extract.evmlog, {
       abiPath: "yearn/3/debtAllocator", chainId: 1,
       address: "0x1e9eB053228B1156831759401dE0E115356b8671",
       from: 20987762n, to: 20987762n, replay: false
     })
   } finally { await mq.down() }
   '
   ```

   Verify `AddedNewVault`/`UpdateDebtAllocator`, deployment provenance, and
   shared `UpdateStrategyDebtRatio` rows in `evmlog`. The Ethereum #471 reference
   is block `20,987,762`, transaction index `163`, log index `422`: vault
   `0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204` was assigned
   `0x1e9eB053228B1156831759401dE0E115356b8671`. The Polygon reference is described
   in Verification below. Repeat discovery/backfill if required evidence is absent.

4. **Dry-run, then write the saved allocator states.** Start with the reference
   vault and inspect the result:

   ```bash
   bun --env-file=.env packages/scripts/src/allocators/refresh.ts --chain=1 --vault=0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204
   bun --env-file=.env packages/scripts/src/allocators/refresh.ts --chain=1 --vault=0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204 --write
   ```

   Omit `--vault` to check/write all stored V3 vaults on a chain. Repeat for each
   deployed chain serving supported vaults, including `137`, `8453` and `747474`.
   Review every unavailable result and record explicit exclusions, including the
   agreed legacy Gnosis vaults. Do not treat a partial run as complete.

   `dry_run` means no write. With `--write`, `applied` means the candidate was
   saved, `skipped` reports the retained state, and `stale` means only stale
   metadata was saved on a prior observation. Inspect support/status as well as
   outcome: `written: true` alone is not a readiness check. Required evidence
   failures exit nonzero, including when stale metadata was saved.

   Inventory the saved state before promotion (read-only SQL):

   ```sql
   SELECT s.chain_id, s.address,
     s.hook->'allocatorState'->>'status' AS status,
     s.hook->'allocatorState'->>'support' AS support,
     s.hook->'allocatorState'->>'reason' AS reason,
     s.hook->'allocatorState'->>'revision' AS revision,
     s.hook->'allocatorState'->>'asOfBlock' AS as_of_block,
     s.hook->'allocatorState'->>'stale' AS stale
   FROM snapshot s JOIN thing t USING (chain_id, address)
   WHERE t.label = 'vault'
     AND COALESCE(s.snapshot->>'apiVersion', t.defaults->>'apiVersion', '') LIKE '3.%'
   ORDER BY s.chain_id, s.address;
   ```

   Every intended supported vault must have a validated revision, no stale
   marker, and the expected assignment/clear with appropriate ratio support.
   Confirm its observation block covers the required changes. Classify custom
   unsupported contracts and deliberate exclusions separately from indexing or
   RPC failures. Finish or correct those failures before promoting web.

5. **Promote the new web/API build and refresh serving caches.** After the gate
   above passes, promote the build from the same commit, then run:

   ```bash
   bun --env-file=.env --tsconfig-override=packages/web/tsconfig.json packages/web/app/api/rest/refresh-vaults.cli.ts
   ```

   Use the target web deployment's database/cache environment. If GraphQL
   response caching is enabled, allow its configured TTL to expire or use the
   deployment's normal targeted invalidation procedure. Compare
   `vault.allocator` / `vault.allocatorState`, `allocator(chainId,vault)` and
   REST `/api/rest/snapshot/{chainId}/{vault}`: address, revision, status and
   strategy ratios must agree. Check Ethereum #471, Polygon, a shared allocator
   used by two vaults, and the documented exclusions. A healthy homepage does
   not establish API readiness.

No database migration is required. Production discovery/backfill and
snapshot/cache activation have not been performed as part of this PR's local
validation. Full allocation-history APIs remain outside this PR.

## Verification

Tests cover local SQL assignment resolution, real ABI decoding and persistence through Kong's loader, shared ratio event storage, initial/replacement discovery, legacy manager metadata, Gnosis/Polygon factory configuration, custom/no-code assignments, two vaults sharing an allocator, zero ratios, explicit clears, atomic updates, and refresh reporting. Synthetic fixtures use the #471 addresses and event boundary without claiming a production replay. A separate local check loaded Polygon's real assignment transaction `0x71455263e2a5440fd9a9e1e4d155f237c20f703d6205883df5cedceccee45bb6` and shared deployment into Kong: at block `86,228,011`, USDC-1 resolved `0x10BC1f4f0dDD8027264E9F10FabE7A751614C207` with target/max ratios `10000/10000` for Fluid and `0/0` for the two other queued strategies. This verifies native projection against chain evidence, not production backfill.
