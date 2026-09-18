# Current vault allocators

Kong #471 concerns current allocator addresses and strategy ratios. A factory
creation event does not prove an allocator is still assigned. This fix reads the
vault's current Role Manager directly and saves the result through the existing
vault snapshot pipeline. Indexing remains in Kong; no Envio integration is added.

## Snapshot behavior

The vault snapshot already reads `role_manager()` at a selected block. Its hook
calls that manager's `getDebtAllocator(vault)` at the same block, then reads both
allocator ratio interfaces with `allowFailure: true`:

- `getStrategyTargetRatio(strategy)` / `getStrategyMaxRatio(strategy)`
- `getStrategyTargetRatio(vault,strategy)` / `getStrategyMaxRatio(vault,strategy)`

Target/max values must form a complete pair from one interface and each be within
0–10,000 basis points. A single valid pair is used; matching valid pairs agree;
conflicting pairs produce null ratios and a diagnostic. Failed getters also
produce null ratios. Valid zeros remain zero. A replacement never inherits its
predecessor's ratios.

A zero manager or zero assignment explicitly clears the allocator and ratios.
A nonlegacy manager that reverts or returns no contract data supplies no usable
assignment and saves nulls, with a diagnostic. A missing manager read or transport
failure retries the snapshot job without saving a partial observation. This
includes aggregate RPC failures that viem wraps as per-call multicall failures.
No error activates a factory-event fallback.

The existing `allocator`, `debts`, and `composition` snapshot fields hold the
result. Under the existing row lock, older V3 snapshot writes are rejected using
block metadata. The insert conflict condition also protects overlapping first
writes. GraphQL's `allocator(chainId,vault)`, `vault.allocator`, and REST read the
same saved snapshot. `Allocator.address` is nullable; malformed addresses and
DB failures retain the generic GraphQL error response.

There is no `allocatorState`, separate revision/staleness protocol, event-based
assignment reconstruction, deployment-family classification, or custom refresh
CLI. Responses have ordinary snapshot/cache freshness, not a live-chain guarantee.

## Security: issue #476

The old factory-event query also allowed an unrelated indexed emitter to select
an allocator by supplying the victim vault argument. This fix removes that query
and has no event fallback, including on RPC failure. A dedicated regression seeds
a newer forged deployment, proves the old SQL would select it, and verifies that
real snapshot extraction and persistence use only the manager-assigned allocator.
See [the security regression and Gnosis audit](allocator-476-audit.md) for evidence
and limits. The public API audit found no non-null allocator/ratio values for the
three legacy vaults; raw target-database verification remains a deployment check.

## Legacy Gnosis preservation

These retired vault/controller pairs retain their stored allocator address and
strategy target/max ratios while the controller remains unchanged:

| Vault | Controller |
| --- | --- |
| `0xa21Cc1a4a239708690134bAeD3a1B93cAD55F625` (Curve EURe) | `0xFB4464a18d18f3FF439680BBbCE659dB2806A187` |
| `0x39B68451F05Aaa020611CF887a7338f0991fFd60` (AJNA EURe) | `0xF9b85835b023ADb7E7b3bD3529B5cd967920E8eC` |
| `0x5012C6bf79b3047ECFFf2F212DfFDA4d2128188f` (EURe) | `0x22eAe41c7Da367b9a15e942EB6227DF849Bb498C` |

The writer preserves those fields from the stored snapshot under the row lock,
matching strategy addresses case-insensitively in debts and composition. Other
accounting fields continue to refresh. Stored legacy strategy rows are included
even after retirement; a partial refresh that would drop them retries instead of
erasing their ratios. New strategy rows without saved ratios
remain null. Missing prior snapshots are not reconstructed. Preservation does
not apply to other Gnosis vaults, replacement controllers, or assignments from a
different controller before a vault returns to its legacy controller. Stored
legacy values remain historical observations, not verified current assignments.

## Scope and rollout

This PR fixes current allocator reporting. New shared-allocator event indexing,
discovery configuration, historical assignment reconstruction, and full allocation
history are deferred. Existing indexing is unchanged. These deferred items were
part of #471's original acceptance criteria and must be tracked separately rather
than claimed complete by this fix.

1. Inventory the three legacy Gnosis snapshots, including their controller,
   allocator, and both ratio fields in debts/composition. Retain the inventory for
   the before/after comparison; missing data cannot be recovered by this fix.
   Check any non-null legacy values for trusted provenance as described in the
   [#476 audit](allocator-476-audit.md); do not silently retain untrusted data.
2. Deploy ingestion and run normal ABI snapshot fanout for affected vaults. Confirm
   successful jobs; investigate unavailable assignments and retry transport failures.
   No allocator assignment-event backfill or dedicated materialization is needed.
3. Check yvUSDC-1 and Polygon assignments/ratios against contract reads at their
   snapshot blocks. Verify the three legacy snapshots retain their allocator data.
4. Promote the web/API change. Refresh REST using the existing command below and
   expire/invalidate GraphQL caches normally. Compare both GraphQL paths and REST.

```bash
bun --env-file=.env --tsconfig-override=packages/web/tsconfig.json packages/web/app/api/rest/refresh-vaults.cli.ts
```

Existing snapshots remain readable before their first refresh; incorrect old
values are corrected when ingestion refreshes them and caches are updated.
No database migration or production backfill is part of this change.

## Verification

Tests exercise both interfaces, pair conflicts/partial failures, real zeros,
replacement/clear behavior, missing manager data, transport errors (including
viem's aggregate failure wrapping), two vaults sharing one allocator, PostgreSQL
persistence, delayed and concurrent initial writes, Gnosis preservation, and
SQL/REST/GraphQL agreement.

Read-only archive checks on 2026-09-18 reproduced Ethereum yvUSDC-1 changing from
`0x1400D5C76D0A630368c8548172e5130983AAA0Ef` at block 20,987,761 to
`0x1e9eB053228B1156831759401dE0E115356b8671` at block 20,987,762. Both interfaces
returned their corresponding strategy ratios, including target/max 2870/3444 for
`0xf766c7293f4e0265ddfa8369f78a808df8ac70c1`.

Current Ethereum was checked at block 26,005,203. Polygon's USDC-1 resolved
`0x10BC1f4f0dDD8027264E9F10FabE7A751614C207` at blocks 86,228,011 and 94,026,805.
Its current default queue was empty, so the current-ratio check explicitly used
its three historical queue strategies: all returned valid 0/0, whereas the
reference block included 10000/10000 for Fluid. These checks validate contract
reads; they do not establish production snapshot refresh or cache readiness.
