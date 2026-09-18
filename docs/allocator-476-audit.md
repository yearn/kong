# Issue #476: allocator lookup and legacy Gnosis audit

Audit performed 2026-09-18 at 16:44:56–16:44:57 UTC against Kong's public REST
and GraphQL APIs. Contract controller reads used archive RPC at the block served
by REST, 48,315,934. Implementation assessed: local PR #472 commit `3609121`.
The security regression and this report are follow-up work on that commit.

## Security behavior

[Issue #476](https://github.com/yearn/kong/issues/476) identifies an untrusted
emitter problem: the old `projectDebtAllocator` query matched the
`NewDebtAllocator` signature and victim vault argument without checking the
emitter. A matching row from another indexed contract could select the allocator
used for ratio RPC calls. This is a snapshot-integrity concern; this audit does
not establish exploitation or downstream APY impact.

The simplified implementation deletes that query. The vault's own contract read
supplies its Role Manager, which supplies the allocator through
`getDebtAllocator(vault)`. Ratio reads only target that returned address. Neither
normal operation nor RPC failure uses deployment events as a fallback. Factory
emitter allowlisting is therefore not needed in this assignment path. Any future
feature that interprets deployment logs must validate its emitters separately.

The PostgreSQL-backed regression
`packages/ingest/abis/yearn/3/vault/snapshot/allocator-security.spec.ts`:

1. Creates a normal factory deployment record and extracts/saves a vault snapshot.
2. Adds a newer matching deployment from an unrelated registered contract.
3. Runs the old SQL query to prove it would select the forged allocator.
4. Runs the real snapshot extractor, vault hook and database writer with mocked
   chain responses. The saved allocator and both sets of ratios remain unchanged;
   no RPC targets the forged allocator or emitter.
5. Fails the manager RPC and verifies no partial snapshot is enqueued and no
   factory fallback is activated.

This is a synthetic regression with actual Kong SQL/extraction/persistence. It
is not an exploit attempt against production.

## Legacy Gnosis inventory

| Vault | REST allocator | GraphQL allocator | Strategy rows | Stored ratio fields exposed by APIs | Controller check |
| --- | --- | --- | --- | --- | --- |
| Curve EURe `0xa21C…F625` | Absent | null | 1 | REST absent; GraphQL null | Matches documented controller |
| AJNA EURe `0x39B6…d60` | Absent | null | 3 | REST absent; GraphQL null | Matches documented controller |
| EURe `0x5012…188f` | Absent | null | 2 | REST absent; GraphQL null | Matches documented controller |

All six REST debt rows and all six composition rows lacked target/max ratios.
All six GraphQL debt rows returned null ratios. Each on-chain controller matched
both the REST snapshot and the documented preservation pair.

The exact addresses, presence-versus-null distinctions, API URLs, retrieval times
and controller observations are in [the evidence file](allocator-476-gnosis-evidence.json).
The plural `allocators` role/account list is a separate field; it was not treated
as the singular allocator assignment.

There are no non-null served allocator addresses or ratios here to certify
against factory provenance. In particular, this audit does not justify
reconstructing missing values from factory logs. The preservation exception
continues to leave missing data unavailable.

## Limits and deployment check

This workspace has no production PostgreSQL connection configuration. A check of
the default local database endpoint was unavailable. Raw production `snapshot`
rows and `evmlog` provenance were not inspected. Public API caches may lag the
underlying database; matching REST/GraphQL responses are serving-layer evidence,
not certification of raw stored state or historical log completeness.

Before deploying, the operator should repeat the inventory directly against the
target database in a read-only transaction:

```sql
BEGIN READ ONLY;
SELECT address, block_number, snapshot->>'role_manager' AS role_manager,
  hook->'allocator' AS allocator, hook->'debts' AS debts,
  hook->'composition' AS composition
FROM snapshot
WHERE chain_id = 100 AND lower(address) = ANY(ARRAY[
  '0xa21cc1a4a239708690134baed3a1b93cad55f625',
  '0x39b68451f05aaa020611cf887a7338f0991ffd60',
  '0x5012c6bf79b3047ecfff2f212dffda4d2128188f'
]);
ROLLBACK;
```

If this reveals non-null allocator values, inspect the corresponding deployment
records, require the configured chain-100 factory emitter
`0xfCF8c7C43dedd567083B422d6770F23B78D15BDe`, and verify the transaction receipt
and allocator's bound vault on-chain. Compare saved ratios with that allocator's
reads at the saved observation block. A valid deployment proves provenance, not
current assignment. If any stored value is untrusted, stop and decide its cleanup
explicitly instead of preserving it silently. Missing values require no recovery
for this PR. Repeat the before/after comparison following the ingestion refresh.

No production data was modified, and this report does not claim a complete
historical security audit.
