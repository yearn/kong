# Envio-backed event extraction

Kong can read mapped event entities from Envio on selected chains. RPC remains the
complete fallback for contracts whose indexed history has not been confirmed and
for events not represented in the entity mapping. Replays still read Kong's database.

## Configuration

Set `USE_ENVIO=true`, `ENVIO_CHAINS`, `ENVIO_GRAPHQL_URL`, and
`ENVIO_HASURA_ADMIN_SECRET`. Also declare confirmed source histories:

```json
[{"chainId":1,"address":"0x0000000000000000000000000000000000000001","abiPath":"yearn/3/vault","fromBlock":"12345678","confirmationId":"parity-2026-10-05"}]
```

This is the JSON value of `ENVIO_CONFIRMED_SOURCES` (default `[]`). The example
address is a placeholder. Confirm each entry only after checking that Envio indexes
that contract and every mapped event from `fromBlock`, for every mapped event. Unmapped overloads remain on RPC.
A chain's progress block alone does not prove per-contract historical coverage.
Newly discovered contracts and ranges before a confirmed start block use RPC.
Malformed coverage configuration fails the job before any coverage write. Duplicate
entries use the latest `fromBlock`, preserving the most restrictive trust boundary, and must share a `confirmationId`. Omitted ids default to `initial`; changing `fromBlock` alone does not reset a revocation.

## Extraction and coverage

- Mapped entities are selected by ABI path and event name. Ambiguous V2 overloads stay on RPC.
- Unmapped events are fetched using RPC and merged in block/log order before hooks run.
- Each mapped event with zero Envio rows is checked against RPC, independently
  of sibling entity results.
  If RPC finds mapped events, `ENVIO_EMPTY_RPC_MISMATCH` reports the source/range and persists a revocation in Redis. Later chunks for that source use RPC, including after process restarts. Independently revalidate history and bump that entry's `confirmationId` to re-enable it; changing another entry does not reset the revocation. A revocation write failure aborts extraction before persistence. Before the cache is ready, sources use RPC.
- Fanout follows RPC head/configured end, so indexer lag does not delay RPC-only
  events. Extraction checks the processed watermark and uses full RPC for chunks
  extending past it, logged as `ENVIO_LAG_RPC` without a breakage warning.
- Hasura errors, absent entity response fields, and missing event arguments trigger
  a full RPC fetch with `ENVIO_RPC_FALLBACK`. Coverage advances only after that
  fetch succeeds. Fanout does not depend on the progress query.
- Pagination uses block number and log index. Integer/address arguments follow
  viem's decoded types; supplied block timestamps avoid another RPC read. RPC timestamps are attached
  before hooks too, giving both paths the same timestamp-bearing log shape.

Partial nonempty histories cannot be detected from entity rows alone. That is why
confirmed-source configuration is mandatory. Revalidate it after changing Envio
handlers, start blocks, or Kong's mapping. RPC fallback costs remain for unmapped
events and every mapped event with an empty result. For sparse factories and registries, enabling Envio adds metadata/entity queries while retaining one RPC request per empty chunk, increasing total request volume. This safety check prioritizes coverage over RPC savings.

## External prerequisites

The Envio deployment must expose all selected fields, maintain the metadata
progress watermark, and retain historical events. In particular, verify legacy
V2 `StrategyAdded` overloads and strategy transfer handlers before declaring their
coverage. No external repository or indexer deployment is changed here.

## Validation and rollout

Automated mock tests cover source gating, missing mappings, malformed responses,
argument validation, repo-local mapping ↔ committed contract ↔ ABI consistency (not live schema drift), fallback extraction, source revocation, and failure before persistence. CI also runs a Redis-backed revocation spec, checking no expiry and persistence after reconnect. Run:

```sh
bun --filter ingest test -- --project mocks
```

Before enabling each source, compare logs and arguments over a historical range
against RPC, including known deployment and strategy-discovery events. Start with
a small set, then widen after parity checks. `USE_ENVIO=false` returns all sources
to RPC. If coverage was incorrectly confirmed, invalidate the affected Kong
strides and refetch; changing the flag alone cannot recover skipped history.

Use #483's per-signature coverage as the long-term indexing model. Both PRs touch
the extractor and fanout and require an explicit integration review when combined.

## Verified schema target

The public deployment `https://indexer.hyperindex.xyz/5a089e4/v1/graphql` was
introspected on 2026-10-05. `docs/envio-schema-contract.json` records the endpoint,
introspection digest, indexer checkout revision and 25 supported mapping contracts.
Every retained entity's selected fields were accepted by live GraphQL queries with `limit: 0`. Address predicates use exact `_eq` against `getAddress(address)`, matching this deployment's EIP-55 storage and permitting btree lookup. Deployments using a different casing require revalidation and a corresponding filter change.
Metadata is `chain_metadata.chain_id/latest_processed_block`, not `_meta`.
The schema itself exposes no version identifier; the endpoint, digest and observed
contract identify this target. Revalidate it before configuring a different deployment.

Both V2 `StrategyAdded` and `StrategyReported` overloads are RPC-only. The target lacks `rateLimit`; `minDebtPerHarvest` and `debtPaid` are non-nullable. The indexer writer mixes modern and legacy reports in one entity and fabricates `debtPaid=0` for legacy rows. The contract records these writer sets and nullability; Kong uses no SQL nullability predicate to distinguish overloads. `yearn/3/registry2` has no `NewEndorsedVault` in Kong's ABI and is
also excluded from that mapping. These removals preserve the RPC event path.
Schema verification establishes field compatibility, not per-source historical
completeness; `ENVIO_CONFIRMED_SOURCES` still requires independent parity checks.
