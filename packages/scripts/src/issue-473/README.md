# Spec: event-discovery gaps on multi-reader contracts (issue #473)

This branch implements the no-migration recovery option described below.
PR #483 supersedes the coverage design with per-signature accounting and is the
preferred general solution. This branch remains an alternative for deployments
that cannot migrate yet; it does not repair every multi-reader event gap.

Direction (user decision): detect the gap when it happens and auto-fix it. No schema change. No historical repair step.

## Context

One address can match more than one ABI reader. All readers share one job ID and one coverage row.
The first reader marks blocks covered. Later readers plan zero strides. Their events are never fetched.
For unendorsed Yearn v3 vaults, `erc4626` runs first, so `StrategyChanged` is never read and strategies are never discovered.

## 1. Failure mechanism before this change

This describes the main base `86de16d1`; paths and named symbols identify the modules without pinning changing line numbers.

- Job ID has no reader: `evmlog-${chainId}-${address}-${from}-${to}` (`packages/ingest/fanout/events.ts`). BullMQ drops the second add.
- Coverage key has no reader: `evmlog_strides` PK `(chain_id, address)` (`packages/db/migrations/sqls/20240214020032-eventsource-up.sql`).
  Written at `packages/ingest/load/index.ts`, read at `fanout/events.ts`.
- `getLogs` is filtered by the reader's ABI events (`packages/ingest/extract/evmlogs.ts`). `erc4626` ABI has only Deposit/Withdraw.
- Config order decides the winner: `erc4626` is first (`config/abis.yaml`), `yearn/3/vault` in the Yearn v3 vault entry.
- `fanout replays` is DB-only: `replay` reads `evmlog`, not RPC (`extract/evmlogs.ts`). It cannot recover unfetched logs.

Limit: production worker logs are gone. The per-vault cause stays inferred; the mechanism reproduces locally.

## 2. Affected contract types

| Address class | Readers that collide | Source |
| --- | --- | --- |
| Unendorsed v3 vault (`erc4626=true`, no `yearn`, `apiVersion>=3`) | `erc4626` + `yearn/3/vault` | `StrategyChanged/hook.ts`, filters `abis.yaml` |
| Tokenized strategy (gets label `vault` AND `strategy`) | `erc4626` + `yearn/3/vault` + `yearn/3/strategy` | `StrategyChanged/hook.ts` |

Endorsed vaults are safe: registry sets `yearn: true` (`yearn/3/registry/event/hook.ts`).

## 3. Options compared

| | A. Exclusive reader selection | B. Reader in job ID + coverage key | C. Detect + autofix (chosen) |
| --- | --- | --- | --- |
| Change | `erc4626` filter excludes v3 | Migration on `evmlog_strides`, ~4 call sites, backfill | 1 check in snapshot hook, 1 flag in events fanout |
| Fixes vault/erc4626 | Yes | Yes | Yes, self-heals on next snapshot |
| Fixes vault/strategy same address | No | Yes | Alert only |
| Preserves erc4626 timeseries | No | Yes | Yes |
| Cost | Low, but breaks a requirement | High: schema, backfill, rollback | One extract per matching ABI reader; paced full-history repairs |

Rejected A: removes erc4626 timeseries from unendorsed vaults; cannot cover the strategy case.
Rejected B: correct by construction, but migration + backfill cost is more than the problem needs.
Note: job-ID change alone does not help; shared coverage still blocks the second reader.

## 4. Design (C)

Detect, in `packages/ingest/abis/yearn/3/vault/snapshot/hook.ts` `projectStrategies`:
- The hook already merges on-chain `get_default_queue` with `StrategyChanged` evmlog rows.
- At the last block continuously covered from inception (capped at the pinned snapshot block), queue strategy absent from the event projection at that same block = gap (addresses are checksummed; unknown revokes cannot remove another strategy). On-chain state is the oracle. No logs, no DB replay needed.
- On gap: `sentry.captureMessage('DISCOVERY_GAP')` with chainId, vault, strategy (pattern: `fanout/abis.ts`).

Autofix, same place:
- `mq.add(mq.job.fanout.events, { abi: <yearn/3/vault config>, source: { chainId, address, inceptBlock }, ignoreStrides: true })`.
- `EventsFanout.fanout` (`fanout/events.ts`): when `ignoreStrides`, set `travelled = undefined` (the `replay`/`ignoreStrides` branch)
  and prefix the job ID with `abiPath` so it cannot collide with the erc4626 job.
- Extract runs the normal RPC path (`replay` stays false). `StrategyChanged` hook creates the strategy things. Upserts are idempotent.
- A peer becomes eligible once any prefix from inception is continuously covered. When ingestion trails the snapshot, an archival RPC queue read and a DB projection both use the last covered block; head-only additions are deferred. Deferred checks emit `DISCOVERY_GAP_DEFERRED` and a reason metric; the first post-deploy snapshot is not guaranteed to qualify.

Overlap gauge, in `AbisFanout.fanout` (`fanout/abis.ts`):
- Count readers per `(chainId, address)`. Every invocation records the current `abi_reader_overlap.addresses` gauge, including zero and busy-skipped invocations, and logs `ABI_READER_OVERLAP_BASELINE` with the count and a sample. Overlaps are expected with this configuration and do not emit warning alerts.
- Probe monitor counters are deferred; the diagnostics above use Sentry gauges and logs.

Limits:
- The deterministic job ID prevents duplicate fanout jobs. Redis admission allows one automatic full-history repair globally per 15 minutes. Each vault's reservation and unconfirmed-enqueue cooldown is a fixed 1 hour (`DISCOVERY_REPAIR_RETRY_SECONDS`, four snapshot cycles), not derived from chain height. A repair whose extraction did not close the gap is re-admitted on the next snapshot cycle after that window; deterministic evmlog job IDs drop chunks still queued from the previous attempt. The detector claims `kong:discovery-gap:<chainId>:<address>` for the same window before the archival probe and `DISCOVERY_GAP` alert, and skips while a repair key exists, so an unhealed vault yields at most one probe and alert per hour. A vault refused by the global budget keeps no waiting entry and asks again on its next detector window; there is no first-time-over-retry ordering, so a vault whose gap heals cannot block others. Successful enqueue does not grant the 24-hour cooldown: only a pinned snapshot at or above the repair comparison block, with a non-empty default queue fully matched by the event projection, can grant it. Failed fanout releases the token-fenced vault reservation while keeping the global budget. Repair job records are removed on completion/failure; alert timing remains independent of admission.
- Autofix re-reads full vault history from `inceptBlock`. Each admitted repair is bounded by `LOG_STRIDE` paging; rollout may have many eligible vaults, so global admission paces that backlog.
- Residual risk: strategy-reader events (`Reported`...) on tokenized strategies have alert only, no oracle.
  Follow-up if investigation of the overlap baseline shows real loss: compare snapshot `lastReport` with latest `Reported` row.
- Residual risk: `snapshot` PK is `(chain_id, address)`; last reader wins. Not changed here.

## 5. Tests (Vitest, `docs/testing.md`)

- Unit: `projectStrategies` with a queue strategy and no evmlog row → alert + one `fanout.events` add with `ignoreStrides`. No gap → none.
- Unit: `EventsFanout` with `ignoreStrides` plans full range despite covering strides; job ID contains `abiPath`.
- Not implemented: integration regression (`containers.spec.ts` pattern). It needs a configured RPC plus Redis/Timescale containers, unavailable during the audit. Intended scenario: thing matching `erc4626` + `yearn/3/vault`, erc4626 covers all blocks,
  snapshot runs, assert `StrategyChanged` extract job is queued. End-to-end recovery remains unverified.
- Redis-backed admission: grant/global budget, snapshot-confirmed 24-hour cooldown, retry after an unconfirmed enqueue, one gap check per window, failure release with retained global budget, and stale-token fencing. CI runs this suite against the container Redis. Detector errors emit `DISCOVERY_GAP_CHECK_FAILED` without aborting snapshots, including archival contract errors filtered by generic exception reporting.
- Unit: overlap gauge records one for a 2-reader address and zero for a 1-reader address.

## 6. Tasks and rollout

1. `ignoreStrides` flag + job ID prefix in `fanout/events.ts`.
2. Gap check + alert + autofix in the vault snapshot hook.
3. Overlap gauge in `fanout/abis.ts`. Probe counters remain out of scope.
4. Tests above.
5. Deploy. Run `fanout abis` twice (detect, then drain).

Acceptance:
- BTC, Curve USG-frxUSD, ETH yVaults show `StrategyChanged` at blocks 25,490,630 / 25,341,800 / 25,475,622 and strategy things exist, with no manual step.
- `DISCOVERY_GAP` compares queue and events at the same continuously covered block, even when ingestion trails head. It clears on a later snapshot after repair extraction and loading finish; no fixed cycle count is guaranteed.
- `erc4626` timeseries for unendorsed vaults has no new gaps (`packages/web/app/api/monitor/tvl-gaps/detector.ts`).
- No migration in the diff.

Rollback: code-only revert.

## Verification of this ticket

Spec file exists at `packages/scripts/src/issue-473/README.md`, claims linked by file path and named symbol, reviewed on the issue.

## Audit validation

Mock regressions cover forced fanout, covered-history skipping, repair enqueue,
initial-load and head-only addition suppression, permanent-gap repair under ingestion lag, mixed-case addresses, and unrelated revocations. The
overlap gauge counts distinct ABI paths, so a source and thing using the same ABI
do not produce a false overlap. Probe counters remain a follow-up; the current
implementation emits Sentry metrics and diagnostic logs, with warning alerts reserved for confirmed discovery gaps.


## Extraction cost

Including `abiPath` in the extract job ID deliberately changes overlapping addresses
from one deduplicated extract to one extract per distinct reader per cycle. An
address with two readers can enqueue two RPC extract jobs, with three readers
three. This preserves each reader's events but permanently increases work.
`abi_reader_overlap.addresses` records the affected-address count; the logged
baseline sample records reader lists. Actual deployment counts and backfill
duration have not been measured by this PR. Automatic repairs are separately
limited to one full-history fanout every 15 minutes across all chains; the normal
fanout busy guard can still defer cycles while that single backfill drains.
