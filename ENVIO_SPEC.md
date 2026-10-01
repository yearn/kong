# Envio-backed evmlog extraction

Kong reads EVM logs from envio entity tables instead of RPC `getLogs`, per chain, behind a flag.
Revision 2: envio dropped `raw_events` (`e33d600`). It doubled storage for handled events and forced
fetching of handler-less events. Kong now reads the per-entity tables.
This document is the umbrella. Each phase below is short and does not repeat this section.

## Context

- Kong has one choke point for log fetching: `packages/ingest/extract/evmlogs.ts:38-48`.
- Kong hooks read only `args`, `blockNumber`, `blockTime`. No hook reads raw `topics` or `data`.
- Hooks do bigint arithmetic on `args` (`packages/ingest/abis/yearn/3/vault/event/StrategyReported/hook.ts:97-107`).
- Envio (`~/Desktop/yearn/envio-indexing`, envio@3.6.1) already indexes chains 1, 137, 8453, 42161, 747474.
- Envio has no `raw_events`. Events without a handler are not fetched.
- Every envio entity carries `chainId, blockNumber, blockTimestamp, blockHash, transactionHash,
  transactionIndex, logIndex`, one emitter-address field (`vaultAddress`, `strategyAddress`,
  `registryAddress`, `factoryAddress`, `roleManagerAddress`), then the event params with the ABI
  input names (`schema.graphql:1-16`, `:52-70`, `:401-416`).
- Kong reads only these `evmlog` event names outside hooks: `StrategyReported`, `Transfer`, `Deposit`,
  `Reported`, `Harvested`, `NewDebtAllocator`, `NewSplitter`, `NewYieldSplitter`, `VestingEscrowCreated`
  (`packages/web/app/api/gql/resolvers/*.ts`, `packages/ingest/abis/**/snapshot/hook.ts`).
- Kong event hooks: 22 files under `packages/ingest/abis/**/event/`. Every hooked event has an envio
  entity with identical param names, except the two gaps in Phase 3b.

## Decisions

| Decision | Chosen | Rejected |
| --- | --- | --- |
| Envio source | Per-entity tables, one static map `abiPath:eventName -> {entity, addressField}` | `raw_events`: doubled storage, fetched handler-less events (`e33d600`) |
| Unmapped events | Not fetched on envio chains. `evmlog` holds consumed events only | Hybrid RPC for the rest: keeps an RPC call per stride, no saving |
| Arg types | Coerce by ABI input type to bigint / checksum address | Keep decimal strings: hooks throw on `profit - fees` |
| Event lookup | Map entry names the ABI event; entity fields selected by ABI input names | Name + param-set match: needed only for a generic table |
| Overloads | One map entry per overload, keyed by envio alias; entity gets nullable columns for the legacy shape | Skip overloads: V2 `StrategyAdded` 4-arg is hooked |
| Head cap | `to = min(rpc head, envio progressBlock)` | Ignore lag: strides marked travelled with no data |
| Flag scope | `USE_ENVIO` + `ENVIO_CHAINS` | Global-only flag: chains not in envio need RPC |
| Test runner | vitest `mocks` project, no containers | mocha: the repo runs vitest |
| Transaction calldata | Per-event `field_selection` on 10 allocation events | Global `input`: one batch overflowed V8 string limit |

## Sequencing

| Phase | Repo | State | Proof |
| --- | --- | --- | --- |
| 1. Enable `raw_events` | envio | Reverted, `e33d600` | none |
| 2. Fix calldata batch overflow | envio | Done, `c6bfd73` | No `Invalid string length` after redeploy |
| 3. Event parity with kong ABIs | envio | Superseded by `e33d600` | Handler-less events are dead config |
| 3b. Entity gaps | envio | Not started | `V2StrategyAdded` rows with `rateLimit`; `Transfer` rows from strategies |
| 4. Kong envio client + flag | kong | Rework, uncommitted | `envio.mock.spec.ts` green |
| 5. Staging rollout | ops | Not started | `evmlog` rows + `thing` rows on chain 8453 |
| 6. Parity check | ops | Not started | SQL count match per (address, range) |

## Phase 1: enable raw_events (reverted)

- `ccf1a26` set `raw_events: true`; `e33d600` removed it. Storage doubled for handled events.

## Phase 2: calldata batch overflow

- Cause: global `field_selection.transaction_fields` included `input`. `raw_events` stores
  `transaction_fields` per row. One batch exceeded V8's max string length in postgres.js.
- Fix: `input` removed from the global list. The 10 events whose handlers reach
  `topLevelInputSelector` (`src/allocation/AllocationHandlers.ts:73`) carry a per-event
  `field_selection` with all five fields, because per-event selection replaces the global one
  (hyperindex `codegen_templates.rs:404-408`).
- Events: YearnV3RoleManager `AddedNewVault`, `RemovedVault`, `UpdateDebtAllocator`;
  YearnV3Vault `UpdateRoleManager`; DebtAllocatorFactory `NewDebtAllocator`;
  AssignedDebtAllocator `SharedUpdateStrategyDebtRatio`, `UpdateStrategyDebtRatios`,
  `UpdateStrategyDebtRatio`, `UpdateKeeper`, `GovernanceTransferred`.

## Phase 3: event parity (superseded)

- `432e13e` added 58 handler-less events for `raw_events`. Without `raw_events` envio does not
  fetch them. They stay in `config.yaml` as dead entries. Cleanup is optional and out of scope.

## Phase 3b: entity gaps

- V2 `StrategyAdded(address,uint256,uint256,uint256)`: `config.yaml:229` aliases it
  `StrategyAddedLegacy` but no handler exists. Add `rateLimit: BigInt` to `V2StrategyAdded`
  (`schema.graphql:571`), make `minDebtPerHarvest`/`maxDebtPerHarvest` nullable, add the handler
  next to `StrategyReportedLegacy` (`src/EventHandlers.ts:1103`).
- `YearnV3Strategy` `Transfer` (`config.yaml:115`): no handler. Add one writing the `Transfer` entity
  with `vaultAddress = srcAddress`, same as the `YearnV3Vault` handler (`src/EventHandlers.ts:300`).
- Proof: redeploy, then one row of each in Hasura.

## Phase 4: kong client and flag

- `useEnvio`, `envioProgressBlock`, `gql`, `coerceValue`: unchanged from revision 1.
- `ENVIO_ENTITIES` in `packages/ingest/envio.ts`: static map keyed `${abiPath}:${eventName}` to
  `{ entity, address }`. Overload entries add `select`: the entity fields that must be non-null,
  e.g. `yearn/2/vault:StrategyAdded` has two entries, `{V2StrategyAdded, vaultAddress, rateLimit}`
  and `{V2StrategyAdded, vaultAddress, minDebtPerHarvest}`. ~25 entries, from the scout table.
- `fetchEnvioLogs(chainId, address, from, to, abi, events, abiPath)`: for each event with a map entry,
  one Hasura query on the entity: `where { chainId, <address>: {_eq: checksummed}, blockNumber: {_gte,_lte} }`,
  select `blockNumber blockTimestamp transactionHash transactionIndex logIndex` + ABI input names.
  Pages of 1000. Events with no entry are skipped. Result sorted by `blockNumber, logIndex`.
- `mapEnvioRow(row, event, chainId)`: `coerceValue` per input, `encodeEventTopics`, `hook = {}`.
  No alias map, no param-set matching.
- `extract/evmlogs.ts:41` passes `abiPath`. `blockTime` reuse and fanout head cap unchanged.
- Address case: entities store checksummed addresses (`getAddress` in handlers). Query with the
  checksummed form, not lowercased.
- Spec `envio.mock.spec.ts`: map lookup, overload pick by non-null field, V2 `StrategyReported`
  entity row -> `EvmLog` with bigint args and correct `topics[0]`, flag test.

## Phase 5: staging rollout

1. Confirm `_meta.progressBlock` is near head on each envio chain.
2. Set `USE_ENVIO=true ENVIO_CHAINS=8453 ENVIO_GRAPHQL_URL=… ENVIO_HASURA_ADMIN_SECRET=…`.
3. Run `fanout abis`. Watch `evmlog` inserts and `evmlog_strides`.
4. Confirm hooks fire: `thing` rows for `yearn/3/vaultFactory` `NewVault`.
5. Widen `ENVIO_CHAINS`. Roll back with `USE_ENVIO=false`; strides stay valid either way.

## Phase 6: parity check

- Fresh envio-fed DB vs prod RPC DB. Compare per (chain, address, block range):
  row count, and `args` as JSON for the same `transaction_hash` + `log_index`.
- Expected: identical. `coerceValue` produces the same JSON as viem decoding through
  `lib/global` BigInt `toJSON`.

## Limits

- Out of scope: dual-write or diff mode. Parity is a manual SQL check.
- Out of scope: chains not in envio (10, 100, 250, 4663). They stay on RPC via `ENVIO_CHAINS`.
- Accepted risk: an empty envio result is indistinguishable from "not indexed". A source missing
  from envio config marks its stride travelled with no data. Mitigation: `ENVIO_ENTITIES` is
  the checklist; every entry must have a matching envio contract address list.
- Accepted risk: on envio chains `evmlog` stores only mapped events. Any new reader of an unmapped
  event name must add a map entry and an envio handler first.
- Accepted risk: Hasura rejects a selected field that the entity lacks. The extract job fails
  loudly instead of storing wrong `args`.
- Accepted risk: new `YearnV3Strategy` Transfer/Deposit/Withdraw events raise envio load.
- Residual risk: reorg handling is envio's. Kong `FULL_NODE_DEPTH` logic is unchanged.
