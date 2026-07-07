import { expect } from 'chai'
import { Pool } from 'pg'
import { getAddress } from 'viem'
import { TestEnvironment, createTestPool } from 'lib/helpers/containers'
import { buildOracleComponents } from './abis/yearn/3/vault/timeseries/apr-oracle/hook'

// Issue #437: prove the new apr-oracle currentApr components flow through the
// untouched read pipeline (output -> refresh job -> Redis -> REST route, and
// GraphQL DB-direct) with no schema/cache change. Seed rows come from the
// production buildOracleComponents so the assertions track what the hook emits.

const CHAIN_ID = 1
const LABEL = 'apr-oracle'
const VAULT = getAddress('0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1')

const APR = 0.1
const CURRENT_APR = 0.2
const FEES = { management: 0.02, performance: 0.1 }
const COMPONENTS = buildOracleComponents(APR, FEES, CURRENT_APR)

function componentValue(component: string): number {
  const found = COMPONENTS.find(c => c.component === component)
  if (!found) throw new Error(`missing seed component ${component}`)
  return found.value
}

type Point = { time: number; component: string; value: number | string }

async function seedTimeseries(pool: Pool) {
  await pool.query(
    `INSERT INTO thing (chain_id, address, label, defaults)
     VALUES ($1, $2, 'vault', $3)`,
    [CHAIN_ID, VAULT, JSON.stringify({ origin: 'yearn', apiVersion: '3.0.4', inceptBlock: 1 })],
  )

  const blockTime = new Date()
  for (const { component, value } of COMPONENTS) {
    await pool.query(
      `INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [CHAIN_ID, VAULT, LABEL, component, value, 1, blockTime],
    )
  }
}

async function fetchRest(webUrl: string, query: string): Promise<Point[]> {
  const res = await fetch(
    `${webUrl}/api/rest/timeseries/apr-oracle/${CHAIN_ID}/${VAULT.toLowerCase()}${query}`,
  )
  expect(res.status).to.equal(200)
  return await res.json() as Point[]
}

async function fetchGql(webUrl: string, component: string): Promise<Point[]> {
  const res = await fetch(`${webUrl}/api/gql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query($chainId: Int!, $address: String!, $label: String!, $component: String) {
        timeseries(chainId: $chainId, address: $address, label: $label, component: $component) {
          component
          value
          time
        }
      }`,
      variables: { chainId: CHAIN_ID, address: VAULT, label: LABEL, component },
    }),
  })
  expect(res.status).to.equal(200)
  const body = await res.json() as { data?: { timeseries?: Point[] }, errors?: unknown }
  expect(body.errors, JSON.stringify(body.errors)).to.equal(undefined)
  return body.data?.timeseries ?? []
}

describe('e2e: apr-oracle currentApr exposure (issue #437)', () => {
  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  beforeAll(async () => {
    env = new TestEnvironment({
      // Web only — seed the output rows directly, no ingest/RPC. POSTGRES_SSL=''
      // makes the web db pool skip SSL against the test Postgres.
      web: { env: { POSTGRES_SSL: '' } },
    })

    const result = await env.start()
    webUrl = result.webUrl
    pool = createTestPool()

    await seedTimeseries(pool)

    await env.runScript('packages/web/app/api/rest/timeseries/refresh-historical.ts')
    await env.runScript('packages/web/app/api/rest/timeseries/refresh.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await env?.stop()
  })

  it('REST defaults apr-oracle to the apr component (backward compatible)', async () => {
    const points = await fetchRest(webUrl, '')
    expect(points.map(p => p.component)).to.deep.equal(['apr'])
    expect(Number(points[0].value)).to.be.closeTo(componentValue('apr'), 1e-9)
  })

  it('REST exposes currentApr via ?components=currentApr', async () => {
    const points = await fetchRest(webUrl, '?components=currentApr')
    expect(points.map(p => p.component)).to.deep.equal(['currentApr'])
    expect(Number(points[0].value)).to.be.closeTo(componentValue('currentApr'), 1e-9)
  })

  it('REST returns both series for repeated components (apr + currentApr)', async () => {
    const points = await fetchRest(webUrl, '?components=apr&components=currentApr')
    const byComponent = new Map(points.map(p => [p.component, Number(p.value)]))
    expect([...byComponent.keys()].sort()).to.deep.equal(['apr', 'currentApr'])
    expect(byComponent.get('apr')).to.be.closeTo(componentValue('apr'), 1e-9)
    expect(byComponent.get('currentApr')).to.be.closeTo(componentValue('currentApr'), 1e-9)
  })

  it('GraphQL timeseries(label: "apr-oracle", component: "currentApr") works without a migration', async () => {
    const points = await fetchGql(webUrl, 'currentApr')
    expect(points.length).to.be.greaterThan(0)
    expect(points.every(p => p.component === 'currentApr')).to.equal(true)
    expect(Number(points[0].value)).to.be.closeTo(componentValue('currentApr'), 1e-9)
  })
})
