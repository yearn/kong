# Envio-backed evmlog extraction, feature-flagged

## Context
- Kong fetches logs via one choke point: `packages/ingest/extract/evmlogs.ts:41` (`rpcs.next().getLogs`).
- `~/Desktop/yearn/envio-indexing` already indexes the events kong cares about on chains 1, 137, 8453, 42161, 747474.
- Goal: env-flag toggle per chain between envio and RPC `getLogs`, no changes to fanout/load/hooks contracts.
- Decision (user): read envio `raw_events` table (generic), not the 95 per-entity tables.

## Facts that shape the design
- Replay path (`evmlogs.ts:38-39`, `fetchLogs`) already pushes pre-decoded `EvmLog` rows through the
  same processing loop → envio rows only need to land in `EvmLogSchema` shape (`packages/lib/types.ts:372`).
- Hooks read only `data.args`, `data.blockNumber`, `data.blockTime`. Nothing reads raw `topics`/`data`.
- `raw_events` (envio@3.6.1): `chain_id, event_id, event_name, contract_name, block_number, log_index,
  src_address (lowercase), block_hash, block_timestamp, block_fields, transaction_fields, params (jsonb,
  bigints as decimal strings, addresses lowercase)`. Hasura auto-tracks it; filter on any column.
- Envio head: `_meta { chainId progressBlock sourceBlock }` GraphQL query (`chain_metadata` is hidden now).
- Fanout `to = getBlockNumber(chainId)` (`fanout/events.ts:31`). Envio lags head → must cap `to` at
  envio `progressBlock`, else strides get marked travelled with no data.
- Existing flag pattern to mirror: `usePriceService()` in `packages/ingest/prices.ts:31`.

## Changes

### envio-indexing repo (1 line + reindex)
- `config.yaml`: add `raw_events: true` at top level. Redeploy/reindex so `raw_events` fills.
- Ensure `field_selection.transaction_fields` keeps `hash`, `transactionIndex` (already present).

### kong: new `packages/ingest/envio.ts`
- `useEnvio(chainId)`: `USE_ENVIO=true` AND `chainId ∈ ENVIO_CHAINS` (comma list). Default off.
- `envioProgressBlock(chainId)`: POST `_meta` query, pick `progressBlock` for chain, wrap in lib `cache.wrap`
  (same helper as `lib/blocks.ts:62`) ~30s TTL.
- `fetchEnvioLogs(chainId, address, from, to, abi, events)`:
  - GraphQL POST to `ENVIO_GRAPHQL_URL`, header `x-hasura-admin-secret: ENVIO_HASURA_ADMIN_SECRET`.
  - `raw_events(where:{chain_id:{_eq}, src_address:{_eq: address.toLowerCase()}, block_number:{_gte,_lte},
    event_name:{_in: events.map(e=>e.name)}}, order_by:[{block_number:asc},{log_index:asc}], limit:1000, offset)`
    loop until short page.
  - Map row → `EvmLog`:
    - `eventName=event_name`, `args=normalize(params)`, `blockNumber=block_number`,
      `blockTime=block_timestamp`, `logIndex=log_index`,
      `transactionHash=transaction_fields.hash`, `transactionIndex=transaction_fields.transactionIndex`,
      `address=getAddress(src_address)`.
    - `normalize(params)`: checksum any `^0x[0-9a-f]{40}$` string via `getAddress`; leave bigint strings.
    - `topics = encodeEventTopics({abi, eventName, args: indexedArgsCoerced})` (viem); coerce indexed
      uint/int args `string→BigInt` first. `signature = topics[0]`. `hook = {}`.
  - Overloaded names: envio aliases V2 `StrategyReportedLegacy`. Alias map `{StrategyReportedLegacy:'StrategyReported'}`
    and pick the ABI overload whose input names match `Object.keys(params)`.

### kong: `packages/ingest/extract/evmlogs.ts`
- Branch at line 37-48: `replay → fetchLogs` | `useEnvio(chainId) → fetchEnvioLogs` | else RPC.
- Line 85: `blockTime: log.blockTime ?? await getBlockTime(...)` (skip RPC when envio supplied it).
- Note `args` parity: viem returns bigint, envio returns decimal strings. Verify evmlog jsonb stores both
  identically (JSON.stringify bigint replacer in load) — see Verification.

### kong: `packages/ingest/fanout/events.ts`
- Line 31: `to = endBlock ?? (useEnvio(chainId) ? min(head, await envioProgressBlock(chainId)) : head)`.

### kong: `.env.example`
- `USE_ENVIO=false`, `ENVIO_CHAINS=`, `ENVIO_GRAPHQL_URL=`, `ENVIO_HASURA_ADMIN_SECRET=`.

### kong: `packages/ingest/envio.spec.ts`
- Unit test (mocha/chai, like `extract/evmlogs.spec.ts`): fixture `raw_events` row → `EvmLogSchema.parse` ok,
  topics[0] equals `toEventSelector` of the ABI event, address checksummed, overload alias resolved.

## Rollout
1. Envio: enable `raw_events`, reindex, confirm `_meta.progressBlock` near head per chain.
2. Kong staging: `USE_ENVIO=true ENVIO_CHAINS=8453` (smallest). Watch `evmlog` inserts + `evmlog_strides`.
3. Parity spot-check: count `evmlog` rows per (address, block range) on a fresh envio-fed DB vs prod RPC DB.
4. Widen `ENVIO_CHAINS`; flip `USE_ENVIO=false` to roll back instantly (strides remain valid either way).

## Residual risks / out of scope
- Envio must index every (chain, address) in kong `config/abis.yaml` for enabled chains. Empty result is
  indistinguishable from "not indexed" → stride marked travelled silently. Keep envio config ⊇ kong sources.
- Chains not in envio (10, 100, 250, 4663...) stay on RPC via `ENVIO_CHAINS`.
- Envio reorg handling is envio's; kong `FULL_NODE_DEPTH` logic unaffected.
- No dual-write/diff mode. Parity check is manual SQL (step 3).

## Verification
- `bun --filter ingest test` scoped to `envio.spec.ts`.
- Local: `make dev`, set envio env vars pointing at `http://localhost:8080/v1/graphql`, run `fanout abis`,
  confirm `evmlog` rows for an envio chain have `signature`, `args`, `block_time` populated and hooks fire
  (`thing` rows created for `yearn/3/vaultFactory` NewVault).
- Args parity: `SELECT args FROM evmlog` for same tx under both modes; values must match as JSON.
