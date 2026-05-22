import { expect } from 'chai'
import { Stack } from 'lib/helpers/tests'

// Reproduces the manual PR test plan for issue #409 (yvusd-estimated-apr leak) in code:
//   - seeds DB with the four PR fixtures (yvUSD, Locked yvUSD, USDC-2, OG USDC Compounder)
//   - simulates the yvUSD APR service emissions (vault-shape vs strategy-shape rows)
//   - warms the Redis snapshot cache via packages/web/.../refresh-snapshot.ts
//   - curls /api/rest/snapshot/:chainId/:address from the web container
//   - asserts the PR acceptance checklist

const chainId = 1
const yvUSD            = '0x696d02Db93291651ED510704c9b286841d506987'
const lockedYvUSD      = '0xAaaFEa48472f77563961Cdb53291DEDfB46F9040'
const usdc2            = '0xAe7d8Db82480E6d8e3873ecbF22cf17b3D8A7308'
const ogCompounder     = '0x0e297dE4005883C757c9F09fdF7cF1363C20e626'
const ogCompounderLower = ogCompounder.toLowerCase()
const label = 'yvusd-estimated-apr'

function vaultDefaults(name: string) {
  return {
    erc4626: true,
    v3: true,
    yearn: true,
    apiVersion: '3.0.4',
    origin: 'yearn',
    name,
    asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    inceptBlock: 24271831,
    inceptTime: 1768861991,
  }
}

describe('snapshot REST: yvusd-estimated-apr leak (#409)', function () {
  this.timeout(15 * 60 * 1000)

  let stack: Stack

  before(async () => {
    stack = await Stack.start({
      chains: { chains: ['mainnet'] },
      abis: { abis: [] }, // skip indexing — bug is query/hydration logic; seed DB directly
      env: {
        HTTP_FULLNODE_1: process.env.HTTP_FULLNODE_1 || '',
        HTTP_ARCHIVE_1: process.env.HTTP_ARCHIVE_1 || '',
      },
    })

    await seed(stack)
    await refreshSnapshotCache(stack)
    await warmSnapshotRoute(stack)
  })

  after(async () => {
    await stack?.stop()
  })

  it('5a. yvUSD keeps yvusd-estimated-apr at both top level and inside composition', async () => {
    const body = await fetchSnapshot(stack, yvUSD)

    expect((body.performance as any)?.estimated?.type).to.eq(label)
    expect((body.performance as any)?.estimated?.apr).to.be.closeTo(0.07, 1e-9)

    const compounderEntry = (body.composition as any[]).find(
      c => c.address?.toLowerCase() === ogCompounderLower,
    )
    expect(compounderEntry, 'compounder composition entry exists').to.exist
    expect(compounderEntry.performance?.estimated?.type).to.eq(label)
    expect(compounderEntry.performance?.estimated?.apr).to.be.closeTo(0.05, 1e-9)
    expect(compounderEntry.performance?.estimated?.apy).to.be.closeTo(0.0512, 1e-9)
  })

  it('5b. Locked yvUSD keeps yvusd-estimated-apr', async () => {
    const body = await fetchSnapshot(stack, lockedYvUSD)
    expect((body.performance as any)?.estimated?.type).to.eq(label)
    expect((body.performance as any)?.estimated?.apr).to.be.closeTo(0.065, 1e-9)
  })

  it('5c. USDC-2 has no yvusd-estimated-apr anywhere in the response', async () => {
    const body = await fetchSnapshot(stack, usdc2)

    // top-level untouched
    expect((body.performance as any)?.estimated?.type).to.not.eq(label)

    // composition compounder entry: no leaked yvUSD context
    const compounderEntry = (body.composition as any[]).find(
      c => c.address?.toLowerCase() === ogCompounderLower,
    )
    expect(compounderEntry, 'compounder composition entry exists').to.exist
    expect(compounderEntry.performance?.estimated?.type ?? null).to.not.eq(label)

    // strong assertion: no object anywhere in the response carries type=yvusd-estimated-apr
    expect(countLeaks(body)).to.eq(0)
  })

  it('5d. OG USDC Compounder standalone does not claim yvusd-estimated-apr', async () => {
    const body = await fetchSnapshot(stack, ogCompounder)
    expect((body.performance as any)?.estimated?.type ?? null).to.not.eq(label)
    expect(countLeaks(body)).to.eq(0)
  })
})

async function fetchSnapshot(stack: Stack, address: string): Promise<Record<string, unknown>> {
  const res = await stack.fetch(`/api/rest/snapshot/${chainId}/${address}`)
  expect(res.status, `GET /api/rest/snapshot/${chainId}/${address}`).to.eq(200)
  return await res.json() as Record<string, unknown>
}

function countLeaks(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0
  let count = 0
  if (Array.isArray(value)) {
    for (const item of value) count += countLeaks(item)
    return count
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === 'type' && v === label) count++
    else count += countLeaks(v)
  }
  return count
}

async function seed(stack: Stack): Promise<void> {
  // ---- thing rows ----
  const things: Array<[string, string, Record<string, unknown>]> = [
    [yvUSD,        'vault',    vaultDefaults('yvUSD')],
    [lockedYvUSD,  'vault',    vaultDefaults('Locked yvUSD')],
    [usdc2,        'vault',    vaultDefaults('USDC-2')],
    [ogCompounder, 'vault',    vaultDefaults('Morpho Yearn OG USDC Compounder')],
    [ogCompounder, 'strategy', vaultDefaults('Morpho Yearn OG USDC Compounder')],
  ]
  for (const [address, lbl, defaults] of things) {
    await stack.query(
      'INSERT INTO thing (chain_id, address, label, defaults) VALUES ($1,$2,$3,$4)',
      [chainId, address, lbl, defaults],
    )
  }

  // ---- snapshot rows ----
  // yvUSD: explicit performance.estimated.type=yvusd-estimated-apr (vault carries its own)
  // Locked yvUSD: same shape
  // USDC-2: composition contains the compounder, but no estimated.type set
  // OG Compounder: composition empty (it's a tokenized strategy), no estimated.type set
  const snapshots: Array<[string, Record<string, unknown>]> = [
    [yvUSD, {
      performance: { estimated: { type: label, apr: 0.07, apy: 0.0725 } },
      composition: [{ address: ogCompounder, performance: {} }],
    }],
    [lockedYvUSD, {
      performance: { estimated: { type: label, apr: 0.065, apy: 0.0671 } },
      composition: [],
    }],
    [usdc2, {
      performance: {},
      composition: [{ address: ogCompounder, performance: {} }],
    }],
    [ogCompounder, {
      performance: {},
      composition: [],
    }],
  ]
  for (const [address, hook] of snapshots) {
    await stack.query(`
      INSERT INTO snapshot (chain_id, address, snapshot, hook, block_number, block_time)
      VALUES ($1,$2,$3,$4,$5, now())
    `, [chainId, address, {}, hook, 24300000])
  }

  // ---- output rows (simulates yvUSD APR service emissions) ----
  // Single shared block_time so the latest-block_time SELECT picks them all in one batch.
  const blockTime = hoursAgo(1)

  // vault-shape rows (no debtRatio component) on the vault addresses:
  await insertOutput(stack, yvUSD,       'netAPR', 0.07,   24300000, blockTime)
  await insertOutput(stack, yvUSD,       'netAPY', 0.0725, 24300000, blockTime)
  await insertOutput(stack, lockedYvUSD, 'netAPR', 0.065,  24300000, blockTime)
  await insertOutput(stack, lockedYvUSD, 'netAPY', 0.0671, 24300000, blockTime)

  // strategy-shape rows (with debtRatio component) on the compounder's address,
  // scoped under yvUSD context. Stored with lowercase address so the composition-side
  // join (strategies normalized to lowercase) finds them when label is resolved.
  await insertOutput(stack, ogCompounderLower, 'netAPR',    0.05,   24300000, blockTime)
  await insertOutput(stack, ogCompounderLower, 'netAPY',    0.0512, 24300000, blockTime)
  await insertOutput(stack, ogCompounderLower, 'debtRatio', 5000,   24300000, blockTime)
}

async function insertOutput(
  stack: Stack,
  address: string,
  component: string,
  value: number,
  blockNumber: number,
  blockTime: Date,
): Promise<void> {
  await stack.query(`
    INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
  `, [chainId, address, label, component, value, blockNumber, blockTime])
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

// Hit the snapshot route once with a generous timeout so Next.js dev compiles it
// before the actual test assertions run.
async function warmSnapshotRoute(stack: Stack): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000)
  try {
    const res = await stack.fetch(`/api/rest/snapshot/${chainId}/${yvUSD}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`warm route status=${res.status}`)
    await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function refreshSnapshotCache(stack: Stack): Promise<void> {
  const res = await stack.web.exec([
    'bun', 'run', 'packages/web/app/api/rest/snapshot/refresh-snapshot.ts',
  ])
  if (res.exitCode !== 0) {
    throw new Error(`refresh-snapshot exit=${res.exitCode}: ${res.output}`)
  }
}
