# Testing

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
node_modules/.bin/ts-node packages/ingest/run-e2e.ts
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
await env.runScript('packages/web/app/api/rest/snapshot/refresh-snapshot.ts')
```

### Full example

```typescript
describe('e2e: ingest → web snapshot', function() {
  this.timeout(8 * 60_000)

  let env: TestEnvironment
  let pool: Pool

  before(async function() {
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
    await env.runScript('packages/web/app/api/rest/snapshot/refresh-snapshot.ts')
  })

  after(async function() {
    await pool?.end()
    await env?.stop()
  })

  it('serves snapshot', async function() {
    const res = await fetch(`${webUrl}/api/rest/snapshot/1/${VAULT_ADDRESS.toLowerCase()}`)
    expect(res.status).to.equal(200)
  })
})
```
