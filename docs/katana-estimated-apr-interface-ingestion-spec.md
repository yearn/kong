# Katana Estimated APR Interface And Ingestion Specification

## Source Review

- Closed Kong PR: yearn/kong#429, "katana-apy updates".
- Related closed Katana PR: yearn/katana-apr-service#45.
- Merged Katana bug-fix PR: yearn/katana-apr-service#48.
- Kong #429 was closed with the note that it had issues and the Katana APR service scope should be decided first.
- The closed Kong PR mixed interface/schema changes with output ingestion, APR promotion, oracle-source tracking, and REST snapshot hydration. The next attempt should split these concerns.

## Goal

Support Katana's new `katana-estimated-apr` webhook rows without conflating:

- gross current forward estimate: `performance.estimated.grossAPR/grossAPY`
- fee-adjusted current forward estimate: `performance.estimated.netAPR/netAPY`
- legacy compatibility values: `performance.estimated.apr/apy`
- legacy historical PPS-derived APY data

`apr/apy` are legacy fields and should keep their existing behavior. New gross and net current estimates must use explicit `grossAPR/grossAPY` and `netAPR/netAPY` names. Apply the same distinction to strategy-level estimated performance.

The implementation should be split into two PRs:

1. Interface/schema exposure.
2. Ingestion, promotion, and snapshot population.

No database migration should be required; the data continues to use existing `output` rows.

## Expected Katana Webhook Rows

Vault-level rows under label `katana-estimated-apr`:

- `apr`
- `apy`
- `grossAPR`
- `grossAPY`
- `netAPR`
- `netAPY`
- component rows such as `baseNetAPY`, `morphoBaseAPY`, `morphoRewardsAPR`, `morphoRewardsAPY`, `morphoKatRewardsAPR`, `steerAPY`, `oracleAPY`, `estimatedDebtCoverage`

Strategy-level rows under the same label and strategy address:

- `apr`
- `apy`
- `grossAPR`
- `grossAPY`
- `netAPR`
- `netAPY`
- component rows
- `katRewardsAPR` remains a component/reward-only value and must not become the strategy APY estimate.

APR oracle rows may also include source metadata:

- `source:getStrategyApr`
- `source:getCurrentApr`

## PR 1: Interface And Schema Exposure

Scope this PR to accepting and exposing the contract. Avoid changing row promotion logic or adding new query behavior.

Tasks:

- Update shared types:
  - `packages/lib/types.ts` `EstimatedAprSchema` adds optional `grossAPR`, `grossAPY`, `netAPR`, and `netAPY`.
- Update REST schemas:
  - `packages/web/app/api/rest/list/db.ts` accepts optional `performance.estimated.grossAPR/grossAPY/netAPR/netAPY`.
  - REST snapshot response schemas should also allow these fields where applicable.
- Update GraphQL schema:
  - `packages/web/app/api/gql/typeDefs/vault.ts` adds `grossAPR`, `grossAPY`, `netAPR`, and `netAPY` to `EstimatedApr`.
  - If oracle source is exposed in this PR, add `source` to the oracle performance type as a nullable string.
- Update docs:
  - `docs/rest.md` sample estimated APR includes `grossAPR`, `grossAPY`, `netAPR`, and `netAPY`.
  - `docs/graphql.md` documents the four explicit gross/net fields.
- Add schema/type tests proving the fields are accepted and serialized.

Acceptance criteria:

- Existing estimated APR consumers still see `apr`, `apy`, `type`, and `components`.
- New `grossAPR/grossAPY/netAPR/netAPY` fields are optional and backward compatible.
- Existing `apr/apy` behavior is unchanged.
- No changes are made to `getLatestEstimatedAprV3`, APR oracle hooks, output SQL, or snapshot hydration in this PR.
- No historical APY field is renamed or repurposed.

## PR 2: Ingestion, Promotion, And Snapshot Population

Scope this PR to turning webhook/output rows into the public `performance` shape.

Tasks:

- Update estimated APR promotion in `packages/ingest/helpers/apy-apr.ts`:
  - `component = 'apr'` maps to legacy `performance.estimated.apr`.
  - `component = 'apy'` maps to legacy `performance.estimated.apy`.
  - `component = 'grossAPR'` maps to `performance.estimated.grossAPR`.
  - `component = 'grossAPY'` maps to `performance.estimated.grossAPY`.
  - `component = 'netAPR'` maps to `performance.estimated.netAPR`.
  - `component = 'netAPY'` maps to `performance.estimated.netAPY`.
  - Keep legacy fallback:
    - If `apr` is absent and `netAPR` exists, populate `estimated.apr` from `netAPR`.
    - If `apy` is absent and `netAPY` exists, populate `estimated.apy` from `netAPY`.
  - Do not populate legacy `apr/apy` from `grossAPR/grossAPY` unless a separate compatibility decision explicitly requires it.
  - Do not leave `apr`, `apy`, `grossAPR`, `grossAPY`, `netAPR`, or `netAPY` inside `components`.
- Update Yearn v3 vault snapshot composition ingestion:
  - Strategy `performance.estimated` keeps top-level legacy `apr/apy`, `grossAPR/grossAPY`, and `netAPR/netAPY`.
  - Non-promoted rows stay under `components`.
  - Reward-only rows such as `katRewardsAPR` remain components.
  - Prefer ingestion-time/snapshot-hook population shared by REST and GraphQL. Avoid REST-only read-time hydration unless equivalent GraphQL/list behavior is also implemented and justified.
- Update APR oracle source ingestion:
  - `packages/ingest/abis/yearn/3/vault/timeseries/apr-oracle/hook.ts` records which read path succeeded.
  - `getStrategyApr(strategyAddress, 0)` should be the preferred strategy-oracle read.
  - `getCurrentApr(address)` remains fallback.
  - Emit `source:getStrategyApr` or `source:getCurrentApr` output rows.
  - Surface the accepted source as `performance.oracle.source` for vault and strategy performance.
  - Mirror this source behavior for the ERC4626 APR oracle hook if it shares the same resolver.
- Update REST/GraphQL read models:
  - Snapshot and list endpoints expose `performance.estimated.grossAPR/grossAPY/netAPR/netAPY`.
  - Snapshot composition entries expose strategy estimated gross/net fields if present.
  - Snapshot/list/GraphQL agree on estimated field meanings.

Acceptance criteria:

- A Katana vault with webhook rows `apr`, `apy`, `grossAPR`, `grossAPY`, `netAPR`, and `netAPY` exposes all six fields distinctly under `performance.estimated`.
- Older feeds that only emit `netAPR/netAPY` still populate `estimated.apr/apy` for backward compatibility.
- `performance.estimated.components` excludes promoted top-level keys.
- Strategy `katRewardsAPR` remains in components and does not overwrite strategy `estimated.apy`.
- `performance.oracle.source` is present when a source row exists and absent/null for older rows.
- REST snapshot, REST list, and GraphQL expose consistent estimated values.

## Tests

Interface PR:

- `EstimatedAprSchema` accepts optional `grossAPR/grossAPY/netAPR/netAPY`.
- REST list/snapshot schema tests accept top-level gross/net fields.
- GraphQL schema exposes `EstimatedApr.grossAPR`, `EstimatedApr.grossAPY`, `EstimatedApr.netAPR`, and `EstimatedApr.netAPY`.
- Docs examples are updated.

Ingestion PR:

- `getLatestEstimatedAprV3` test:
  - `apr/apy` preserve legacy behavior.
  - `grossAPR/grossAPY` are preserved as top-level gross fields.
  - `netAPR/netAPY` are preserved as top-level net fields.
  - legacy net-only rows still populate `apr/apy`.
  - promoted keys are removed from `components`.
- Snapshot hook test:
  - strategy composition preserves gross and net estimated fields separately.
  - `baseNetAPY` and other diagnostic rows remain in components.
  - `katRewardsAPR` remains a component.
- APR oracle tests:
  - `getStrategyApr` success emits `source:getStrategyApr`.
  - fallback success emits `source:getCurrentApr`.
  - `getLatestOracleApr` returns the source.
- REST/GraphQL integration tests:
  - vault-level `performance.estimated.grossAPR/grossAPY/netAPR/netAPY` are visible.
  - composition strategy estimates are visible consistently across REST and GraphQL.

## Out Of Scope

- Computing Katana forward APY. That belongs in katana-apr-service.
- Changing historical PPS APY semantics.
- Including KAT app rewards in forward estimated APY unless product confirms they are auto-compounded.
- Reintroducing the broad, mixed PR shape from #429.
