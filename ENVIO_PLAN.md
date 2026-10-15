# Envio integration plan

The original `raw_events` design is superseded. See [ENVIO_SPEC.md](ENVIO_SPEC.md)
for the entity-table implementation and its coverage requirements.

1. Verify source addresses, the indexed start block, and all mapped event handlers in Envio.
2. Compare event counts and arguments against RPC before confirming a source.
3. Add verified histories to `ENVIO_CONFIRMED_SOURCES`; enable the chain flag.
4. Unconfirmed sources, earlier history, and unmapped events continue using RPC.
5. Monitor ingestion and expand confirmed coverage after parity checks.

No production rollout or external Envio deployment is performed by this PR.
