import { expect } from 'chai'
import { TestEnvironment, createTestPool, pollForRow, triggerFanout } from 'lib/helpers/containers'
import { Pool } from 'pg'

// Reported issue: on katana, the REST snapshot of allocator vault 0x80c34B…
// served strategy 0x6E0D… (Morpho Yearn OG v2 USDC Compounder) with no
// performance.estimated at all — its strategyRewardsAPR / katRewardsAPR was
// missing — even though the katana-apr service reports it.
//
// Root cause (PR #443): a sibling strategy of the parent emitted a
// katana-estimated-apr row-set with only netAPR/netAPY. fetchStrategyPerformance
// built its estimated as {type, apr, apy} without the components key required by
// CompositionSchema, so extractComposition threw on every extract.snapshot run.
// The parent's snapshot was never rewritten, so NONE of its strategies' estimated
// blocks (including 0x6E0D's katRewardsAPR) reached the REST response.
//
// This drives the full ingest -> snapshot -> REST pipeline on the real katana
// chain (747474) using the reported addresses. Estimated-apr rows are seeded
// (live katana-apr webhook currently returns [] for these vaults): parent +
// STRATEGY with katRewardsAPR, and a queue sibling with netAPR/netAPY-only
// (the prod freeze shape). Asserts 0x6E0D's composition entry surfaces
// katRewardsAPR. Under the unfixed hook the sibling freezes composition and the
// gate times out; with the fix the rewards APR is present. Pure mapping logic
// is unit-tested in abis/yearn/3/vault/snapshot/hook.spec.ts.

const CHAIN_ID = 747474
const LABEL = 'katana-estimated-apr'

// the reported strategy: a v3 vault AND a strategy of PARENT_VAULT, whose
// katana-apr emission carries katRewardsAPR.
const STRATEGY_VAULT = '0x6E0D2096BA6A3fe35c8186077F81BEf2c33E5bed'
const STRATEGY_INCEPT = 37839045

// the allocator vault that embeds STRATEGY_VAULT in its composition.
const PARENT_VAULT = '0x80c34bd3a3569e126e7055831036aa7b212cb159'
// Capped near chain head to skip ~33M blocks of history. Composition is read
// from the vault's current on-chain state (get_default_queue / debts), not from
// replayed events, and the estimated-apr rows come from the live webhook, so a
// recent incept still assembles the full composition.
const PARENT_INCEPT = 37839045

// sibling already in parent get_default_queue. Only indexed sources hit the
// live webhook; seed this one with the prod failure shape (netAPR/netAPY only)
// so unfixed extractComposition still freezes the parent snapshot.
const SIBLING_STRATEGY = '0xD46dFDAA7cAA8739B0e3274e2C085dFFc8d4776A'

function source(address: string, inceptBlock: number) {
  return { chainId: CHAIN_ID, address, inceptBlock }
}

// Both vaults share USDC on katana. manuals alone never fill asset/decimals
// (registry/StrategyChanged do in full history); without them tvl Zod-fails.
const ASSET = '0x203a662b0bd271a6ed5a60edfbd04bfce608fd36'
const DECIMALS = 6

function manual(address: string, inceptBlock: number) {
  return {
    chainId: CHAIN_ID,
    address,
    label: 'vault',
    defaults: {
      inceptBlock,
      origin: 'yearn',
      apiVersion: '3.0.4',
      asset: ASSET,
      decimals: DECIMALS,
    },
  }
}

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
// block from seeded katana-estimated-apr rows. Under the unfixed hook a sibling
// strategy's netAPR/netAPY-only rows make extractComposition throw before load,
// so the parent snapshot is never rewritten — this never holds and the poll
// times out, which is the regression firing.
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

describe('e2e: katana strategy rewards APR surfaces in parent composition (PR #443)', () => {
  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  beforeAll(async () => {
    env = new TestEnvironment({
      configs: {
        chains: ['katana'],
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

    // Seed estimated-apr: sibling = freeze shape; strategy carries katRewardsAPR;
    // parent top-level estimate sets estimatedAprLabel for composition path.
    // (Live S_KATANA_APR webhook returns [] for these vaults as of 2026-07-20.)
    await seedOutput(pool, SIBLING_STRATEGY, { netAPR: 0.03, netAPY: 0.031 })
    await seedOutput(pool, STRATEGY_VAULT, {
      netAPR: 0.05,
      netAPY: 0.051,
      katRewardsAPR: 0.012,
    })
    await seedOutput(pool, PARENT_VAULT, { netAPR: 0.04, netAPY: 0.041 })

    // Drive fanout until the parent's composition carries the strategy's
    // estimated block; needs a parent re-snapshot after seeds, so re-trigger
    // on each empty poll.
    await pollForRow(
      pool,
      COMPOSITION_ASSEMBLED_SQL,
      [CHAIN_ID, PARENT_VAULT, STRATEGY_VAULT, LABEL],
      { timeoutMs: 15 * 60_000, intervalMs: 15_000, onTick: () => triggerFanout('abis', {}) },
    )

    // StrategyChanged registers every strategy as a nameless vault thing. Test
    // abis have no `things` filter so those never get snapshotted, and
    // refresh-vaults Zod-fails on the missing name. Stop ingest first so
    // historical replay can't re-create orphans between the delete and refresh,
    // then drop them; only the manuals matter here.
    await result.ingestContainer?.stop()
    await pool.query(
      `DELETE FROM thing
       WHERE label = 'vault'
         AND lower(address) NOT IN (lower($1), lower($2))`,
      [STRATEGY_VAULT, PARENT_VAULT],
    )

    await env.runScript('packages/web/app/api/rest/refresh-vaults.cli.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await env?.stop()
  })

  it('parent composition surfaces the strategy katRewardsAPR', async function() {
    const snapshot = await fetchRestSnapshot(webUrl, PARENT_VAULT)
    const entry = snapshot.composition?.find(c => c.address.toLowerCase() === STRATEGY_VAULT.toLowerCase())
    expect(entry, 'strategy missing from parent composition').to.not.be.undefined
    expect(entry!.performance?.estimated?.type).to.equal(LABEL)
    expect(entry!.performance?.estimated?.components?.katRewardsAPR).to.be.a('number')
  })

  it('parent keeps its own top-level katana estimate', async function() {
    const { performance } = await fetchRestSnapshot(webUrl, PARENT_VAULT)
    expect(performance?.estimated?.type).to.equal(LABEL)
    expect(performance?.estimated?.apr).to.be.a('number')
    expect(performance?.estimated?.apy).to.be.a('number')
  })
})
