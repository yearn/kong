# Neon REST cache refresh

Standalone refresh workers for Kong's prepared REST responses. This package reads
the existing Kong tables and writes serialized JSON into its own
`neon_rest_cache` schema. It does not change Vercel routes, Redis contents, or the
Vercel cron schedule. All Neon schedules in `neon.ts` start disabled.

The queries and shaping helpers are shared with the web app; the worker supplies
its own database pools and Postgres cache adapter. It never imports the web Redis
cache client. The small changes to the web query helpers only defer construction
of their default pools until a caller actually needs those defaults.

## Try it locally against a test branch

Use Node.js 24 and a Neon test branch containing Kong's source tables. The cache
migration creates only the new cache schema; it does not create or seed Kong's
`thing`, `snapshot`, `output`, or `evmlog` tables. A fresh empty database can
exercise the storage layer but cannot run the real refresh queries.

From the repository root, install dependencies with `bun install`. Then:

```sh
cd packages/neon-rest-cache
cp .env.example .env
```

Edit this package's `.env` directly:

- `DATABASE_URL`: pooled, writable connection to your **test branch**. Cache
  publication and job coordination use this connection.
- `SOURCE_DATABASE_URL`: optional read replica on that same branch. For local
  execution, also set `REST_CACHE_USE_SOURCE_REPLICA=true` to use it. Otherwise
  source queries use `DATABASE_URL`.
- `REST_CACHE_ADMIN_TOKEN`: a long random token for manual jobs and inspection.
- `REST_CACHE_HISTORICAL_FULL_REFRESH`: leave `false` for normal operation.

The commands below load this explicit env file using Node; do not source the
repository's `.env`.

```sh
npm run db:migrate
npm run build
npm start
```

The local server listens on `127.0.0.1:8787`. Start with aggregate TVL:

```sh
curl --fail-with-body -X POST \
  http://127.0.0.1:8787/admin/run/tvl-refresh \
  -H 'Authorization: Bearer <your-token>'

curl --fail-with-body \
  http://127.0.0.1:8787/admin/status \
  -H 'Authorization: Bearer <your-token>'
```

Manual requests wait for the job to finish. Authentication is checked before a
database pool is used. `/health` is a process health check, not a database or cache
freshness check.

## Jobs and cache inspection

All six jobs can be invoked at `POST /admin/run/<job>` with the admin token:

| Job | Output | Disabled schedule (UTC) |
| --- | --- | --- |
| `tvl-refresh` | Aggregate TVL and summary | `*/30 * * * *` |
| `refresh-cache` | Vault lists, snapshots, tranche systems/controllers | `*/30 * * * *` |
| `timeseries-refresh` | Recent vault/tranche/controller time series | `0 * * * *` |
| `timeseries-refresh-historical` | Incremental historical time series | `15 2 * * *` |
| `reports-refresh` | Recent strategy reports | Manual only |
| `reports-refresh-historical` | Historical strategy reports | Manual only |

Read a published entry at `GET /admin/cache/<job>/<URL-encoded-cache-key>` with
the same token. The response contains the job, key, and decoded stored envelope
(including its `value` field). This is an inspection API, not a replacement for
the public REST API. Existing cache-key builders are reused.

You can also inspect committed entries with SQL:

```sql
SELECT e.job, e.key, octet_length(e.value) AS payload_bytes, j.last_success_at
FROM neon_rest_cache.entries e
JOIN neon_rest_cache.jobs j
  ON j.job = e.job AND j.published_generation = e.generation
ORDER BY e.job, e.key;
```

There is no automatic import from Upstash. The first historical run therefore
rebuilds each series. Later runs read their previously published payloads and
preserve `refreshedAt`/`reconciledAt`, the correction window, and weekly full
reconciliation. Measure the first run separately from normal incremental runs.

## Publication and failures

Each job has a renewable database lease and a separate staging generation. Cache
readers see only the last successfully published generation. A successful job
switches the generation pointer atomically; a failure leaves the old cache
available. Keys absent from a completed new generation disappear from that job's
published snapshot. Related TVL views and the combined vault/tranche refresh are
published together.

Scheduled occurrences and invocation IDs are deduplicated. Fencing prevents an
expired worker from overwriting a newer generation. Busy jobs return a retryable
response. Cleanup retains the current and previous generations and removes older
data in bounded batches. Job coordination does not depend on in-memory state.

Jobs execute within the request. There is no detached background work or durable
batch cursor: an interrupted historical job retries from the last *published*
history, not from its incomplete staging batch. Before enabling the daily
schedule, confirm the full run fits Neon's 15-minute time-to-first-byte limit and
2 GiB runtime memory. Schedules remain disabled until deliberately enabled.

## Deploying for manual testing

Nothing in the implementation automatically deploys or applies the schema.
From this directory, link the Neon CLI to the intended test project/branch, apply
the cache migration to that branch, run `npm run build`, and use
`neon deploy --env .env`. Deployment uploads the prebuilt bundle from
`dist/function` without rebundling. The config
requires an admin token and declares all four triggers with `enabled: false`.
Neon injects the deployed branch's `DATABASE_URL`; it is not copied from the
local env file into the Function configuration.

If using `SOURCE_DATABASE_URL`, verify it points to the same branch before each
deployment. A copied production replica URL would defeat branch isolation. The
deployment config enables replica reads only when a source URL is supplied;
otherwise it explicitly disables them, even if an old URL remains in remote env.
Do not enable schedules or remove the existing Vercel cron entries for this
manual-testing rollout. Trigger availability must also be verified: the initial
audit's trigger-list API returned 404 for the otherwise valid Kong branch.

Neon invokes `/jobs/<job>` by POST. Those routes verify Neon trigger deliveries;
they do not accept the Vercel `CRON_SECRET` convention. Use the authenticated
`/admin/run/<job>` routes for manual calls. The local adapter rejects forged Neon
trigger headers, since it does not sit behind Neon's trusted edge.

## Validation and cost comparison

`npm test` includes a storage integration suite using a disposable Postgres
container; it requires Docker and does not use `.env` credentials. `npm run
typecheck` and `npm run build` check the standalone package.

Compare the same source snapshot and time cutoff when checking old/new payloads.
Check numeric strings, null gaps, ordering, cache keys, historical metadata, and
failed-run publication. Track payload sizes, refresh duration, database compute,
and Neon Function/network usage before deciding on a public API cutover. This
package does not assume that database-to-Function bytes are exempt from egress.
