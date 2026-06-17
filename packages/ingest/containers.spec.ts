import { expect } from 'chai'
import { Pool } from 'pg'
import { TestEnvironment, createTestPool, pollForRow, triggerFanout } from 'lib/helpers/containers'

const VAULT_ADDRESS = '0x696d02Db93291651ED510704c9b286841d506987'
const CHAIN_ID = 1

describe('e2e: ingest → web snapshot', function() {
  this.timeout(8 * 60_000)

  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  before(async function() {
    env = new TestEnvironment({
      configs: {
        chains: ['mainnet'],
        abis: [{
          abiPath: 'yearn/3/vault',
          sources: [{ chainId: CHAIN_ID, address: VAULT_ADDRESS, inceptBlock: 24271831 }],
        }],
        manuals: [{
          chainId: CHAIN_ID,
          address: VAULT_ADDRESS,
          label: 'vault',
          defaults: { inceptBlock: 24271831, origin: 'yearn', apiVersion: '3.0.4' },
        }],
      },
      ingest: true,
      web: true,
    })

    const result = await env.start()
    webUrl = result.webUrl
    pool = createTestPool()

    await triggerFanout('abis', { id: 'e2e-test' }, 'e2e-test-fanout')

    await pollForRow(pool, `
      SELECT 1 FROM thing t
      JOIN snapshot s ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
    `, [CHAIN_ID, VAULT_ADDRESS])

    await env.runScript('packages/web/app/api/rest/refresh-vaults.ts')
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
