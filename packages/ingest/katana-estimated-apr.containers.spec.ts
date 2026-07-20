import { expect } from 'chai'
import { Pool } from 'pg'
import { TestEnvironment, createTestPool, pollForRow, triggerFanout } from 'lib/helpers/containers'

// PR #443: netAPR/netAPY-only estimated-apr rows froze vault snapshots.
//
// The katana APR service emits 'katana-estimated-apr' rows for both allocator
// vaults and their strategies. When a strategy's latest emission carries ONLY
// netAPR/netAPY (no other components), fetchStrategyPerformance used to build
// estimated as {type, apr, apy} without the components key required by
// CompositionSchema. extractComposition then threw a ZodError on every
// extract.snapshot run, so the parent vault's snapshot was never rewritten and
// the REST API served stale composition with no estimated block (katana vaults
// 0x80c34B…/0x9A6bd7… were stuck for 3 days).
//
// This covers what the unit test can't: the full ingest -> snapshot -> REST
// pipeline. Under the unfixed hook the parent's composition never assembles
// (the gate below times out); with the fix the composition entry lands carrying
// estimated with components: {}. The pure mapping logic is unit-tested in
// abis/yearn/3/vault/snapshot/hook.spec.ts. Runs on mainnet addresses because
// the bug is label-driven, not chain-specific.

const CHAIN_ID = 1
const LABEL = 'katana-estimated-apr'

// itself a v3 vault AND a strategy of PARENT_VAULT; gets netAPR/netAPY-only
// rows -> the shape that used to break the parent's composition parse.
const STRATEGY_VAULT = '0x0e297dE4005883C757c9F09fdF7cF1363C20e626'
const STRATEGY_INCEPT = 21176924

// embeds STRATEGY_VAULT in its composition; its own rows give it a top-level
// estimate, which sets estimatedAprLabel for the composition path.
const PARENT_VAULT = '0xAe7d8Db82480E6d8e3873ecbF22cf17b3D8A7308'
const PARENT_INCEPT = 21176924

function source(address: string, inceptBlock: number) {
  return { chainId: CHAIN_ID, address, inceptBlock }
}

function manual(address: string, inceptBlock: number) {
  return {
    chainId: CHAIN_ID,
    address,
    label: 'vault',
    defaults: { inceptBlock, origin: 'yearn', apiVersion: '3.0.4' },
  }
}

// All components of one emission MUST share a single block_time so
// getLatestEstimatedAprV3 selects them as one row-set.
async function seedOutput(pool: Pool, address: string, components: Record<string, number>) {
  const blockTime = new Date()
  for (const [component, value] of Object.entries(components)) {
    await pool.query(
      `INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [CHAIN_ID, address, LABEL, component, value, 1, blockTime],
    )
  }
}

type Estimated = { type?: string, apr?: number, apy?: number, components?: Record<string, number> }

async function fetchRestSnapshot(webUrl: string, address: string) {
  const res = await fetch(`${webUrl}/api/rest/snapshot/${CHAIN_ID}/${address.toLowerCase()}`)
  expect(res.status).to.equal(200)
  return await res.json() as {
    performance?: { estimated?: Estimated }
    composition?: Array<{ address: string, performance?: { estimated?: Estimated } }>
  }
}

// Gate: the parent's composition entry for the strategy carries the estimated
// block. Under the unfixed hook this NEVER holds — extractComposition throws
// before load, the snapshot is never rewritten — so a timeout here is the
// regression firing.
// Params: [chainId($1), parent($2), strategy($3), label($4)].
const COMPOSITION_ASSEMBLED_SQL = `
  SELECT 1 FROM snapshot s JOIN thing t
    ON t.chain_id = s.chain_id AND t.address = s.address
  WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(s.hook->'composition', '[]'::jsonb)) c
      WHERE lower(c->>'address') = lower($3)
        AND c->'performance'->'estimated'->>'type' = $4
    )
`

describe('e2e: netAPR/netAPY-only estimated-apr rows must not freeze snapshots (PR #443)', () => {
  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  beforeAll(async () => {
    env = new TestEnvironment({
      configs: {
        chains: ['mainnet'],
        abis: [{
          abiPath: 'yearn/3/vault',
          sources: [
            source(STRATEGY_VAULT, STRATEGY_INCEPT),
            source(PARENT_VAULT, PARENT_INCEPT),
          ],
        }],
        manuals: [
          manual(STRATEGY_VAULT, STRATEGY_INCEPT),
          manual(PARENT_VAULT, PARENT_INCEPT),
        ],
      },
      ingest: true,
      web: { env: { POSTGRES_SSL: '' } },
    })

    const result = await env.start()
    webUrl = result.webUrl
    pool = createTestPool()

    // Seed BEFORE the snapshot hooks run. The strategy gets the prod failure
    // shape: netAPR/netAPY only, nothing else.
    await seedOutput(pool, PARENT_VAULT, { netAPR: 0.05, netAPY: 0.051 })
    await seedOutput(pool, STRATEGY_VAULT, { netAPR: 0.03, netAPY: 0.031 })

    // Drive fanout until the parent's composition carries the strategy's
    // estimated block; composition needs the strategy snapshot to land first,
    // so re-trigger on each empty poll.
    await pollForRow(
      pool,
      COMPOSITION_ASSEMBLED_SQL,
      [CHAIN_ID, PARENT_VAULT, STRATEGY_VAULT, LABEL],
      { timeoutMs: 15 * 60_000, intervalMs: 15_000, onTick: () => triggerFanout('abis', {}) },
    )

    await env.runScript('packages/web/app/api/rest/refresh-vaults.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await env?.stop()
  })

  it('parent composition entry carries estimated with empty components instead of throwing', async function() {
    const snapshot = await fetchRestSnapshot(webUrl, PARENT_VAULT)
    const entry = snapshot.composition?.find(c => c.address.toLowerCase() === STRATEGY_VAULT.toLowerCase())
    expect(entry, 'strategy missing from parent composition').to.not.be.undefined
    expect(entry!.performance?.estimated?.type).to.equal(LABEL)
    expect(entry!.performance?.estimated?.apr).to.equal(0.03)
    expect(entry!.performance?.estimated?.apy).to.equal(0.031)
    expect(entry!.performance?.estimated?.components).to.deep.equal({})
  })

  it('parent keeps its own top-level estimate', async function() {
    const { performance } = await fetchRestSnapshot(webUrl, PARENT_VAULT)
    expect(performance?.estimated?.type).to.equal(LABEL)
    expect(performance?.estimated?.apr).to.equal(0.05)
    expect(performance?.estimated?.apy).to.equal(0.051)
  })
})
