# Event reader identity — issue #473

Event extraction is specific to an ABI reader: `erc4626` and `yearn/3/vault`
request different events and run different hooks. Completion by one reader must
not suppress the other reader's work for the same contract and block range.

## Implementation

- Include `abiPath` in event extraction job IDs; retain the `evmlog` job name.
- Include `abi_path` in the existing `evmlog_strides` primary key:
  `(chain_id, address, abi_path)`.
- Carry reader identity through extraction and loading, and use it for every
  coverage read and write. Repeated work for the same reader still deduplicates.
- Commit fetched events and reader coverage together. Serialize updates to the
  same coverage row, including concurrent first writes.
- Keep one stored row per chain event. Merge hook enrichment on conflict so an
  overlapping reader with an empty hook result cannot erase existing enrichment.
- Database replay can rerun hooks on stored events, but cannot establish RPC
  coverage. Give replay jobs a separate ID suffix to prevent them from
  suppressing chain extraction.

Reader eligibility and endorsement metadata are unchanged. This change adds no
reader-selection service, audit service, recovery command, or new coverage table.
Operational recovery of the three known Ethereum peers remains separate.

## Migration and deployment

Existing coverage rows receive the reserved `__legacy__` reader identity, retaining
their original strides. They cannot safely be assigned to a real reader because
the original schema did not record which reader completed the work. Real readers
do not fall back to legacy coverage.

This means the first normal ingestion cycles after deployment will fetch history
for each reader from its configured start. Plan RPC capacity and queue throughput
accordingly. No migration or history extraction is run as part of implementing
this change.

Pause automatic and manual ABI fanout, drain outstanding event fanout, extraction,
and load jobs, and stop old workers before applying the migration. Deploy the
updated producers and consumers together before resuming scheduling. Old load
payloads lack reader identity and cannot be accepted by the new loader.

Do not merge reader-specific coverage into one address-wide row on rollback.
The down migration refuses to run while non-legacy rows exist; resolving that
state requires an explicit operational decision. Legacy-only rollback restores
the previous schema and coverage.

## Regression checks

- Different readers of the same address/range receive different job IDs; repeated
  work by the same reader receives the same ID.
- After generic ERC-4626 coverage commits, Yearn still schedules that range;
  completing Yearn coverage allows subsequent Yearn fanout to skip it.
- Empty successful batches advance only their own reader, while replay and failed
  transactions do not establish coverage.
- Concurrent first writes retain both ranges, and shared event rows retain hook
  enrichment when another reader supplies an empty result.
- Migration preserves legacy coverage, permits multiple reader rows per address,
  and refuses unsafe rollback.
