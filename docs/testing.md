# Testing

## TypeScript toolchain

Use Bun 1.4.2 (`packageManager` in the root manifest, also pinned in CI and
Dockerfiles). Install with `bun install --frozen-lockfile`.

Workspace `typecheck` scripts run the native TypeScript 7.0.2 compiler (`tsc`),
resolved directly from `@typescript/native` by `scripts/typecheck.mjs`, which
checks both the package version and compiler output before running. ESLint, Next.js 15 and ts-node
still need the JavaScript compiler API, so workspace `typescript` dependencies
alias Microsoft's `@typescript/typescript6` compatibility package. Its underlying
6.x API is pinned by `bun.lock`; typecheck does not use the potentially ambiguous
`node_modules/.bin/tsc` shim.
The ESLint parser/plugin use 8.69.0, which supports that API. Do not replace the
compatibility alias with native TypeScript: these tools import its JavaScript API.

```bash
bun --filter terminal typecheck
bun --filter ingest typecheck
bun --filter lib typecheck
bun --filter web typecheck
```

The native compiler requires ES2020 for the web package's BigInt usage. Node
packages set `rootDir` to the workspace parent so ts-node can compile their
cross-workspace imports with the 6.x API. Next.js continues to transpile browser
code using its own build pipeline.

Typecheck remains blocking for terminal. Ingest, lib and web compare diagnostics against
`scripts/typecheck-baseline.json`; new diagnostic identities or additional
occurrences fail CI. Known errors remain visible in that file and must be fixed
and removed as follow-up work. A green workflow means no new errors, not zero errors.

## Unit tests

Run unit tests for `lib` and `ingest`:

```bash
bun --filter lib test
bun --filter ingest test
```

Both spin up isolated Postgres and Redis via Testcontainers automatically.

---

## E2E tests

E2E tests use `TestEnvironment` from `lib/helpers/containers` to run the full stack — ingest indexer + web API — as Docker containers sharing a network with the test Postgres and Redis.

### Prerequisites

- Docker running
- `.env` at repo root with RPC endpoints (`HTTP_ARCHIVE_*`, `HTTP_FULLNODE_*`, `YDAEMON_API`, etc.)

### Running

```bash
bun --filter ingest test:containers
```

---

## TestEnvironment API

### Basic usage

```typescript
import {
  TestEnvironment,
  createTestPool,
  pollForRow,
  triggerFanout,
} from 'lib/helpers/containers'

const env = new TestEnvironment({
  configs: {
    chains: ['mainnet'],
    abis: [{
      abiPath: 'yearn/3/vault',
      sources: [{ chainId: 1, address: '0x...', inceptBlock: 24271831 }],
    }],
    manuals: [{
      chainId: 1,
      address: '0x...',
      label: 'vault',
      defaults: { inceptBlock: 24271831, origin: 'yearn', apiVersion: '3.0.4' },
    }],
  },
  ingest: true,
  web: true,
})

const { webUrl } = await env.start()
// ... test ...
await env.stop()
```

### Options

| Field | Type | Description |
|---|---|---|
| `configs.chains` | `string[]` | Chain names to enable (e.g. `['mainnet', 'arbitrum']`) |
| `configs.abis` | `AbiEntry[]` | ABI sources to index |
| `configs.manuals` | `ManualEntry[]` | Manual vault definitions |
| `ingest` | `boolean \| IngestContainerOptions` | Start ingest container |
| `web` | `boolean \| WebContainerOptions` | Start web container |

`configs` is injected as `.local.yaml` files into the containers at startup — same as placing files in `config/` locally.

RPC endpoints (`HTTP_ARCHIVE_*`, `HTTP_FULLNODE_*`, etc.) are read automatically from `.env`.

### Helpers

**`createTestPool()`** — creates a `pg.Pool` pointed at the test Postgres (env vars set by `env.start()`).

**`pollForRow(pool, sql, params, timeoutMs?)`** — polls every 3s until the query returns at least one row, or throws after `timeoutMs` (default 120s).

**`triggerFanout(jobName, data, jobId?)`** — adds a BullMQ job to the `fanout` queue on the test Redis. Use to kick off indexing without waiting for the cron.

**`env.runScript(scriptPath)`** — runs a TypeScript script from the repo root as a child process, inheriting the test env vars (Postgres host/port, Redis URL, etc.). Use to run refresh scripts against the test containers:

```typescript
await env.runScript('packages/web/app/api/rest/refresh-vaults.cli.ts')
```

### Full example

```typescript
describe('e2e: ingest → web snapshot', () => {
  let env: TestEnvironment
  let pool: Pool

  beforeAll(async () => {
    env = new TestEnvironment({
      configs: {
        chains: ['mainnet'],
        abis: [{
          abiPath: 'yearn/3/vault',
          sources: [{ chainId: 1, address: VAULT_ADDRESS, inceptBlock: 24271831 }],
        }],
        manuals: [{
          chainId: 1, address: VAULT_ADDRESS, label: 'vault',
          defaults: { inceptBlock: 24271831, origin: 'yearn', apiVersion: '3.0.4' },
        }],
      },
      ingest: true,
      web: true,
    })

    const { webUrl } = await env.start()
    pool = createTestPool()

    // trigger indexing
    await triggerFanout('abis', { id: 'test' }, 'test-fanout')

    // wait for snapshot in DB
    await pollForRow(pool, `
      SELECT 1 FROM thing t
      JOIN snapshot s ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
    `, [1, VAULT_ADDRESS])

    // populate Redis cache
    await env.runScript('packages/web/app/api/rest/refresh-vaults.cli.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await env?.stop()
  })

  it('serves snapshot', async () => {
    const res = await fetch(`${webUrl}/api/rest/snapshot/1/${VAULT_ADDRESS.toLowerCase()}`)
    expect(res.status).to.equal(200)
  })
})
```

## Local end-to-end tests

`bun --filter ingest test:containers` is local-only: configure the guarded
`HTTP_ARCHIVE_1` / `HTTP_ARCHIVE_747474` RPC endpoints and start the required
Docker/Timescale/Redis services. CI has no archive credentials and does not run
this command; a green test job does not establish end-to-end RPC coverage.

## Known typecheck diagnostics

Run `node scripts/check-typecheck-baseline.mjs` after installing dependencies.
The checked-in baseline records the TypeScript 7 audit's existing ingest (17),
lib (1), and web (2) diagnostics. It compares file, code, message and occurrence
count, ignoring line/column so unrelated edits can move existing diagnostics.
Fixing an error passes immediately; remove its baseline entry afterward. Do not
refresh the baseline to accept a regression. Terminal remains a zero-error gate.

Web typecheck uses checked-in `next-types.d.ts` for Next ambient declarations.
The separate `tsconfig.typecheck.json` excludes generated `next-env.d.ts` and
`.next` files so local builds do not change the gate's input files. The base
`tsconfig.json` still includes those files for Next's production route-type checks.

`packages/scripts` is deliberately outside this initial gate: its operational
scripts still have an unaudited diagnostic backlog and require a separate baseline
audit. The gate currently covers terminal, ingest, lib and web; it does not claim
type safety for the scripts workspace.

CI initializes the installed compiler through the workspace's actual `production`
command (`ts-node --transpile-only index.ts`) with `KONG_COMPILER_SMOKE=true`.
The entrypoint validates the compatibility API and exits before loading external
services or enqueuing jobs. This gates ts-node compiler initialization, not a full
container boot, service connectivity or production Next build.

`load.output` accepts current `{ batch }` payloads and wraps legacy single-output
payloads as a one-element batch before validation, preserving queued work across
upgrades. Invalid payloads still fail schema validation.

A nonempty diagnostic baseline must match at least one compiler diagnostic.
A silent zero-diagnostic result fails and lists the unmatched entries, guarding
against lost compiler coverage. When fixing the last known error in a workspace,
remove its now-resolved baseline entries in the same commit. Resolving some entries
while others still match remains allowed.
