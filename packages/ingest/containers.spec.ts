import { expect } from 'chai'
import { Queue } from 'bullmq'
import { Pool } from 'pg'
import IORedis from 'ioredis'
import { TestEnvironment } from 'lib/helpers/containers'

const VAULT_ADDRESS = '0x696d02Db93291651ED510704c9b286841d506987'
const CHAIN_ID = 1

const CHAINS_YAML = `
chains:
  - mainnet
`.trim()

const ABIS_YAML = `
cron:
  name: AbiFanout
  queue: fanout
  job: abis
  schedule: '*/15 * * * *'
  start: false
abis:
  - abiPath: yearn/3/vault
    sources:
      - chainId: 1
        address: '${VAULT_ADDRESS}'
        inceptBlock: 24271831
`.trim()

const MANUALS_YAML = `
manuals:
  - chainId: 1
    address: '${VAULT_ADDRESS}'
    label: vault
    defaults:
      inceptBlock: 24271831
      origin: yearn
      apiVersion: 3.0.4
`.trim()

async function pollForSnapshot(pool: Pool, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { rows } = await pool.query(`
      SELECT 1 FROM thing t
      JOIN snapshot s ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
    `, [CHAIN_ID, VAULT_ADDRESS])
    if (rows.length > 0) return
    await new Promise(r => setTimeout(r, 3_000))
  }
  throw new Error(`snapshot not found in DB after ${timeoutMs}ms`)
}

describe('e2e: ingest → web snapshot', function() {
  this.timeout(8 * 60_000)

  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  before(async function() {
    env = new TestEnvironment({
      configs: { chains: CHAINS_YAML, abis: ABIS_YAML, manuals: MANUALS_YAML },
      ingest: {
        env: {
          HTTP_ARCHIVE_1: process.env.HTTP_ARCHIVE_1 || '',
          HTTP_FULLNODE_1: process.env.HTTP_FULLNODE_1 || '',
          YDAEMON_API: process.env.YDAEMON_API || '',
        }
      },
      web: true,
    })

    const result = await env.start()
    webUrl = result.webUrl

    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
    })

    // trigger one-shot fanout so ingest indexes the vault
    const fanoutQueue = new Queue('fanout', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
      }
    })
    await fanoutQueue.add('abis', { id: 'e2e-test' }, { jobId: 'e2e-test-fanout' })
    await fanoutQueue.close()

    // wait for ingest to write thing + snapshot to postgres
    await pollForSnapshot(pool)

    // refresh: read snapshot from postgres, write to redis (same logic as refresh-snapshot.ts)
    const { rows } = await pool.query(`
      SELECT
        t.chain_id AS "chainId",
        t.address,
        t.defaults,
        s.snapshot,
        s.hook
      FROM thing t
      JOIN snapshot s ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
    `, [CHAIN_ID, VAULT_ADDRESS])

    if (rows.length === 0) throw new Error('snapshot row missing after poll')

    const row = rows[0]
    const vaultSnapshot = { chainId: row.chainId, address: row.address, ...row.defaults, ...row.snapshot, ...row.hook }
    const redisKey = `rest:snapshot:${CHAIN_ID}:${VAULT_ADDRESS.toLowerCase()}`

    const redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
    })
    await redis.set(redisKey, JSON.stringify({ value: vaultSnapshot }))
    await redis.quit()
  })

  after(async function() {
    await pool?.end()
    await env?.stop()
  })

  it('web serves snapshot for vault', async function() {
    const res = await fetch(`${webUrl}/api/rest/snapshot/${CHAIN_ID}/${VAULT_ADDRESS.toLowerCase()}`)
    expect(res.status).to.equal(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).to.have.property('chainId', CHAIN_ID)
    expect(String(body.address).toLowerCase()).to.equal(VAULT_ADDRESS.toLowerCase())
  })
})
