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

## 1. Failure mechanism (confirmed in code)

- Job ID has no reader: `evmlog-${chainId}-${address}-${from}-${to}` (`packages/ingest/fanout/events.ts:40`). BullMQ drops the second add.
- Coverage key has no reader: `evmlog_strides` PK `(chain_id, address)` (`packages/db/migrations/sqls/20240214020032-eventsource-up.sql:21`).
  Written at `packages/ingest/load/index.ts:69-77`, read at `fanout/events.ts:34-35`.
- `getLogs` is filtered by the reader's ABI events (`packages/ingest/extract/evmlogs.ts:29-44`). `erc4626` ABI has only Deposit/Withdraw.
- Config order decides the winner: `erc4626` is first (`config/abis.yaml:9`), `yearn/3/vault` at `:120`.
- `fanout replays` is DB-only: `replay` reads `evmlog`, not RPC (`extract/evmlogs.ts:38-40,145`). It cannot recover unfetched logs.

Limit: production worker logs are gone. The per-vault cause stays inferred; the mechanism reproduces locally.

## 2. Affected contract types

| Address class | Readers that collide | Source |
| --- | --- | --- |
| Unendorsed v3 vault (`erc4626=true`, no `yearn`, `apiVersion>=3`) | `erc4626` + `yearn/3/vault` | `StrategyChanged/hook.ts:47-73`, filters `abis.yaml:12-15,123-126` |
| Tokenized strategy (gets label `vault` AND `strategy`) | `erc4626` + `yearn/3/vault` + `yearn/3/strategy` | `StrategyChanged/hook.ts:48-73` |

Endorsed vaults are safe: registry sets `yearn: true` (`yearn/3/registry/event/hook.ts:34-51`).

## 3. Options compared

| | A. Exclusive reader selection | B. Reader in job ID + coverage key | C. Detect + autofix (chosen) |
| --- | --- | --- | --- |
| Change | `erc4626` filter excludes v3 | Migration on `evmlog_strides`, ~4 call sites, backfill | 1 check in snapshot hook, 1 flag in events fanout |
| Fixes vault/erc4626 | Yes | Yes | Yes, self-heals on next snapshot |
| Fixes vault/strategy same address | No | Yes | Alert only |
| Preserves erc4626 timeseries | No | Yes | Yes |
| Cost | Low, but breaks a requirement | High: schema, backfill, rollback | Low |

Rejected A: removes erc4626 timeseries from unendorsed vaults; cannot cover the strategy case.
Rejected B: correct by construction, but migration + backfill cost is more than the problem needs.
Note: job-ID change alone does not help; shared coverage still blocks the second reader.

## 4. Design (C)

Detect, in `packages/ingest/abis/yearn/3/vault/snapshot/hook.ts` `projectStrategies` (`:185-210`):
- The hook already merges on-chain `get_default_queue` with `StrategyChanged` evmlog rows.
- Only after coverage is continuous from inception through the pinned snapshot block, queue strategy absent from the event projection = gap (addresses are checksummed; unknown revokes cannot remove another strategy). On-chain state is the oracle. No logs, no DB replay needed.
- On gap: `sentry.captureMessage('DISCOVERY_GAP')` with chainId, vault, strategy (pattern: `fanout/abis.ts:12`).

Autofix, same place:
- `mq.add(mq.job.fanout.events, { abi: <yearn/3/vault config>, source: { chainId, address, inceptBlock }, ignoreStrides: true })`.
- `EventsFanout.fanout` (`fanout/events.ts:22-45`): when `ignoreStrides`, set `travelled = undefined` (same line as replay, `:34`)
  and prefix the job ID with `abiPath` so it cannot collide with the erc4626 job (`:40`).
- Extract runs the normal RPC path (`replay` stays false). `StrategyChanged` hook creates the strategy things. Upserts are idempotent.
- A peer becomes eligible for repair once coverage reaches its pinned snapshot block continuously from inception. Deferred checks emit `DISCOVERY_GAP_DEFERRED` and a reason metric; the first post-deploy snapshot is not guaranteed to qualify.

Overlap metric, in `AbisFanout.fanout` (`fanout/abis.ts:26-59`):
- Count readers per `(chainId, address)`. Every fanout records `abi_reader_overlap.addresses`, including zero, and logs `ABI_READER_OVERLAP_BASELINE` with the count and a sample. Overlaps are expected with this configuration and do not emit warning alerts.
- Probe monitor counters are deferred; the diagnostics above use Sentry metrics and logs.

Limits:
- Loop guard is the deterministic job ID only. Failed repair fanout jobs retry three times with exponential backoff from one minute and are removed after final failure, allowing a later snapshot cycle to retry. Successful repair fanout jobs retain their ID for 24 hours; the gap alert remains independent of this deduplication.
- Autofix re-reads full vault history from `inceptBlock`. Accepted: rare, bounded by `LOG_STRIDE` paging.
- Residual risk: strategy-reader events (`Reported`...) on tokenized strategies have alert only, no oracle.
  Follow-up if investigation of the overlap baseline shows real loss: compare snapshot `lastReport` with latest `Reported` row.
- Residual risk: `snapshot` PK is `(chain_id, address)`; last reader wins. Not changed here.

## 5. Tests (Vitest, `docs/testing.md`)

- Unit: `projectStrategies` with a queue strategy and no evmlog row → alert + one `fanout.events` add with `ignoreStrides`. No gap → none.
- Unit: `EventsFanout` with `ignoreStrides` plans full range despite covering strides; job ID contains `abiPath`.
- Not implemented: integration regression (`containers.spec.ts` pattern). It needs a configured RPC plus Redis/Timescale containers, unavailable during the audit. Intended scenario: thing matching `erc4626` + `yearn/3/vault`, erc4626 covers all blocks,
  snapshot runs, assert `StrategyChanged` extract job is queued. End-to-end recovery remains unverified.
- Unit: overlap metric records one for a 2-reader address and zero for a 1-reader address.

## 6. Tasks and rollout

1. `ignoreStrides` flag + job ID prefix in `fanout/events.ts`.
2. Gap check + alert + autofix in the vault snapshot hook.
3. Overlap metric in `fanout/abis.ts`. Probe counters remain out of scope.
4. Tests above.
5. Deploy. Run `fanout abis` twice (detect, then drain).

Acceptance:
- BTC, Curve USG-frxUSD, ETH yVaults show `StrategyChanged` at blocks 25,490,630 / 25,341,800 / 25,475,622 and strategy things exist, with no manual step.
- `DISCOVERY_GAP` fires only after continuous coverage reaches the snapshot block. It clears on a later snapshot after repair extraction and loading finish; no fixed cycle count is guaranteed.
- `erc4626` timeseries for unendorsed vaults has no new gaps (`packages/web/app/api/monitor/tvl-gaps/detector.ts`).
- No migration in the diff.

Rollback: code-only revert.

## Verification of this ticket

Spec file exists at `packages/scripts/src/issue-473/README.md`, every claim pinned to `file:line`, reviewed on the issue.

## Audit validation

Mock regressions cover forced fanout, covered-history skipping, repair enqueue,
initial-load and lagging-ingestion suppression, mixed-case addresses, and unrelated revocations. The
overlap metric counts distinct ABI paths, so a source and thing using the same ABI
do not produce a false overlap. Probe counters remain a follow-up; the current
implementation emits Sentry metrics and diagnostic logs, with warning alerts reserved for confirmed discovery gaps.
