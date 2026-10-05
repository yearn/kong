# Envio-backed event extraction

Kong can read mapped event entities from Envio on selected chains. RPC remains the
complete fallback for contracts whose indexed history has not been confirmed and
for events not represented in the entity mapping. Replays still read Kong's database.

## Configuration

Set `USE_ENVIO=true`, `ENVIO_CHAINS`, `ENVIO_GRAPHQL_URL`, and
`ENVIO_HASURA_ADMIN_SECRET`. Also declare confirmed source histories:

```json
[{"chainId":1,"address":"0x0000000000000000000000000000000000000001","abiPath":"yearn/3/vault","fromBlock":"12345678"}]
```

This is the JSON value of `ENVIO_CONFIRMED_SOURCES` (default `[]`). The example
address is a placeholder. Confirm each entry only after checking that Envio indexes
that contract and every mapped event from `fromBlock`, including legacy overloads.
A chain's progress block alone does not prove per-contract historical coverage.
Newly discovered contracts and ranges before a confirmed start block use RPC.
Malformed coverage configuration fails the job before any coverage write.

## Extraction and coverage

- Mapped entities are selected by ABI path, event name, and overload fields.
- Unmapped events are fetched using RPC and merged in block/log order before hooks run.
- Empty Envio results are checked against the complete requested RPC event set.
- Fanout is capped at the minimum of RPC head, configured end, and Envio progress
  for confirmed sources. Extraction also checks progress, protecting queued jobs.
- Hasura errors, absent entity response fields, and missing event arguments fail
  the job. They cannot become successful empty intervals.
- Pagination uses block number and log index. Integer/address arguments follow
  viem's decoded types; supplied block timestamps avoid another RPC read.

Partial nonempty histories cannot be detected from entity rows alone. That is why
confirmed-source configuration is mandatory. Revalidate it after changing Envio
handlers, start blocks, or Kong's mapping. RPC fallback costs remain for unmapped
events; this PR does not promise zero RPC calls for every ABI.

## External prerequisites

The Envio deployment must expose all selected fields, maintain the metadata
progress watermark, and retain historical events. In particular, verify legacy
V2 `StrategyAdded` overloads and strategy transfer handlers before declaring their
coverage. No external repository or indexer deployment is changed here.

## Validation and rollout

Automated mock tests cover source gating, missing mappings, malformed responses,
argument validation, fallback extraction, and failure before persistence. Run:

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
