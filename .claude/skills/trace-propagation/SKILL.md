---
name: trace-propagation
description: Trace a data value through kong's pipeline hop-by-hop to find where propagation stalls
---

## Activation Criteria
Use this skill when:
- A value (APR, TVL, snapshot field) changed at its source but isn't showing on the public API
- After deploying an ingest/webhook fix, to verify data propagates end to end
- The user asks to "track propagation", "find the bottleneck", or "check where the data is stuck"

## Requirements

Environment (in `~/.env`, exported into login shells):
- `KONG_PROD_RO_REPLICA_DB` — read-only replica of the **live** database. It is NOT a
  separate dev environment; what you read here is what prod has (modulo replication lag).
- `KONG_REDIS_RO_URL` — read-only connection to the prod REST cache.
- `gh` CLI authenticated for yearn/kong (workflow run history).

Sourcing gotcha: values containing `&` (postgres URLs) must be quoted in `~/.env` or
`set -a; source ~/.env` silently fails to set them (the `&` backgrounds the assignment).
Values are quoted now; keep them quoted.

## The propagation chain

Values flow through these hops. Each hop has a probe (see `probes.sh` in this skill's
directory) and a freshness stamp. The method is binary search: find the last hop with
the correct value and the first hop without it — the bottleneck is between them.

| # | Hop | Probe | Advances when |
|---|-----|-------|---------------|
| 1 | Source service (per `config/subscriptions.yaml`) | `probes.sh source <url>` | live — computes at call time |
| 2 | `output` table | `probes.sh output <chainId> <address> <label>` | ingest fanout runs the webhook |
| 3 | `snapshot` table (`hook->'performance'`) | `probes.sh snapshot <chainId> <address>` | fanout runs the snapshot hook |
| 4 | Redis REST cache (`rest:snapshot:{chainId}:{address}`) | `probes.sh redis <chainId> <address>` | `/api/cron/refresh-cache` Vercel cron runs |
| 5 | Public REST API / CDN edge | `probes.sh rest <chainId> <address>` | CDN TTL expires (`s-maxage=900`) |

Start by resolving the label to its subscription in `config/subscriptions.yaml`
(source URL, abiPath, filter addresses). Then probe hops in order and build a table:
one row per hop, showing the value and its timestamp. Name the stale hop and its cause.

Fallback when DB credentials are unavailable: the public GraphQL API
(`https://kong.yearn.fi/api/gql`) reads the live DB — `probes.sh gql <chainId> <address>`
for snapshots, and the `timeseries` query for output series (pass `timestamp:` — results
come back ascending, so without it you get the oldest points).

## Interpreting what you see

- **Compare like with like**: output-vs-output, snapshot-vs-cache. An `output` row and a
  `snapshot` estimate stamped near the same time can legitimately differ — the snapshot
  hook reads whatever webhook batch is loaded at hook time, and intermediate batches get
  replaced (below). That skew is normal, not corruption.
- **Day-bucket upserts**: `output` keeps one row per (address, label, component, day).
  A new batch replaces the same day's rows — earlier intraday batches "disappear".
  Don't treat a vanished batch as data loss.
- **Deterministic vs live components**: components derived from chain state at the
  trigger block (e.g. `debtRatio`) match exactly across batches at the same block;
  live-computed ones (APRs from external APIs) drift between calls. Use this to tell
  batch-timing skew from real corruption. Digit-for-digit equality is the standard for
  "same batch".
- **Cadences**: prod fanout runs every ~15–30 min (don't infer cadence from historical
  `output` rows — day-bucket upserts keep only each day's last batch, which makes it look
  daily; read `snapshot.block_time` advancing instead). The `config/abis.yaml` cron
  `start:` flag only controls BullMQ job registration at ingest boot — prod is driven
  elsewhere. `/api/cron/refresh-cache` is scheduled `*/30 * * * *` in
  `packages/web/vercel.json`; Vercel Cron fires close to schedule — check the project's
  cron/function logs in Vercel before concluding anything is broken. The CDN adds up to
  15 min on top of Redis.
- **Neon sleeps**: the replica suspends when idle; the first connection fails with
  "Control plane request failed". `probes.sh` retries automatically.

## Watch mode

To wait for the public API to catch up, run `probes.sh watch <chainId> <address> <value-prefix>`
as a background task — it polls every 60s and exits when the served value starts with the
prefix (or after 30 min).

## Guardrails

- Every probe is **read-only**. Keep it that way.
- The one known unstick action — `curl -H "Authorization: Bearer $CRON_SECRET"
  https://<deployment>/api/cron/refresh-cache` — is a mutation. Present it as an option; **never trigger it without the user's explicit
  go in this conversation**.
- Never print credential values (connection strings contain passwords). Refer to env vars
  by name; `probes.sh` handles redaction.
