import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { getAddress } from 'viem'
import { calculateAggregateTvl, getAggregateTvlStrategyRefs } from './aggregate'
import { getAggregateStrategies, getAggregateVaults } from './db'

// Run with RUN_DB_TESTS=1; requires Docker. All writes target this disposable container.
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('aggregate TVL PostgreSQL reads', () => {
  let container: StartedPostgreSqlContainer | undefined
  let pool: Pool | undefined
  const parent = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  const child = getAddress('0x0000000000000000000000000000000000000002')
  const strategy = getAddress('0x1234567890abcdef1234567890abcdef12345678')
  const missing = getAddress('0x0000000000000000000000000000000000000004')
  const exposure = {
    parentChainId: 1, parentVaultAddress: parent,
    targetChainId: 1, targetVaultAddress: child, attributableUsd: 20,
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('timescale/timescaledb:latest-pg16').start()
    pool = new Pool({ connectionString: container.getConnectionUri() })
    await pool.query('CREATE EXTENSION IF NOT EXISTS timescaledb')
    // Use the repository's actual table definitions and primary keys.
    await pool.query(await readFile(new URL(
      '../../../../../db/migrations/sqls/20240214020032-eventsource-up.sql', import.meta.url,
    ), 'utf8'))
  }, 120_000)

  afterAll(async () => {
    try { await pool?.end() } finally { await container?.stop() }
  }, 60_000)

  beforeEach(async () => {
    await pool!.query('TRUNCATE thing, snapshot')
  })

  async function thing(chain: number, address: string, label: string, defaults: object = {}) {
    await pool!.query('INSERT INTO thing VALUES ($1, $2, $3, $4)', [chain, address, label, defaults])
  }

  async function snapshot(chain: number, address: string, hook: object, state: object = {}) {
    await pool!.query(
      'INSERT INTO snapshot (chain_id, address, snapshot, hook, block_number) VALUES ($1, $2, $3, $4, 100)',
      [chain, address, state, hook],
    )
  }

  it('joins canonical addresses once across labels, scopes chains, and preserves missing snapshots', async () => {
    await thing(1, parent, 'vault', { yearn: true, v3: true })
    await thing(1, parent, 'strategy')
    await thing(10, parent, 'vault', { origin: 'yearn' })
    await thing(1, child, 'vault', { yearn: true })
    await thing(1, missing, 'vault', { origin: 'yearn' })
    await snapshot(1, parent, { tvl: { close: 100 }, asset: { address: child } }, { asset: child })
    await snapshot(10, parent, { tvl: { close: 40 } })
    // Contract state overrides defaults for the inclusion filter.
    await snapshot(1, child, { tvl: { close: 60 } }, { yearn: false })

    const rows = await getAggregateVaults(pool!)
    assert.equal(rows.length, 3)
    assert.equal(rows.filter(row => row.chainId === 1 && row.address === parent).length, 1)
    assert.deepEqual(rows.find(row => row.chainId === 1 && row.address === parent)?.mergedSnapshot.asset, { address: child })
    assert.equal(rows.find(row => row.address === missing)?.hook, null)
    const result = calculateAggregateTvl(rows)
    assert.equal(result.tvl, 140)
    assert.equal(result.vaults.length, 2)
  })

  it('excludes retired and hidden v3 vaults only', async () => {
    await thing(1, parent, 'vault', { yearn: true, v3: true })
    await thing(1, child, 'vault', { yearn: true, v3: true })
    await thing(1, missing, 'vault', { yearn: true })
    await snapshot(1, parent, { tvl: { close: 100 }, meta: { isRetired: true, isHidden: true } })
    await snapshot(1, child, { tvl: { close: 60 }, meta: { isRetired: false, isHidden: true } })
    await snapshot(1, missing, { tvl: { close: 40 }, meta: { isRetired: true, isHidden: true } })

    const rows = await getAggregateVaults(pool!)
    assert.deepEqual(rows.map(row => row.address).sort(), [child, missing].sort())
  })

  it.each([true, false])('projects nested fields without changing aggregate TVL when v3 is %s', async (v3) => {
    const hook = {
      tvl: { close: 100, open: 90, high: 120, low: 80 },
      asset: { address: strategy, name: 'Underlying token', symbol: 'TOKEN', decimals: 18 },
      v3: !v3,
      debts: [
        { strategy: child, currentDebtUsd: 30, totalDebtUsd: 45, lastReport: 123, totalGainUsd: 10 },
        null, 'invalid', 42, [],
        { strategy, currentDebtUsd: '20', activation: 456 },
      ],
      composition: [{ address: child, name: 'Child vault' }],
    }
    await thing(1, parent, 'vault', { yearn: true, v3: !v3, asset: { address: child } })
    await thing(1, child, 'vault', { yearn: true })
    await snapshot(1, parent, hook, { v3, asset: child })
    await snapshot(1, child, { tvl: { close: 150 } })

    const rows = await getAggregateVaults(pool!)
    const parentRow = rows.find(row => row.address === parent)!
    assert.deepEqual(parentRow.hook, {
      tvl: { close: 100 },
      debts: [
        { strategy: child, currentDebtUsd: 30, totalDebtUsd: 45 },
        { strategy, currentDebtUsd: '20', totalDebtUsd: null },
      ],
    })
    assert.deepEqual(parentRow.mergedSnapshot, { asset: { address: strategy }, v3 })
    const unprojectedRows = rows.map(row => row.address === parent
      ? { ...row, hook, mergedSnapshot: { asset: hook.asset, v3 } }
      : row)
    const updatedAt = '2026-01-02T03:04:05.000Z'
    assert.deepEqual(
      calculateAggregateTvl(rows, [], updatedAt),
      calculateAggregateTvl(unprojectedRows, [], updatedAt),
    )
    assert.equal(calculateAggregateTvl(rows).tvl, v3 ? 220 : 205)
    assert.deepEqual(getAggregateTvlStrategyRefs(rows), getAggregateTvlStrategyRefs(unprojectedRows))
  })

  it.each([
    { debts: undefined }, { debts: null }, { debts: {} },
    { debts: 'invalid' }, { debts: 42 }, { debts: [] },
  ])('ignores absent, empty, or non-array debts: %j', async ({ debts }) => {
    await thing(1, parent, 'vault', { yearn: true })
    await snapshot(1, parent, { tvl: { close: 100 }, debts })

    const rows = await getAggregateVaults(pool!)
    assert.deepEqual(rows[0].hook, { tvl: { close: 100 }, debts: [] })
    assert.equal(calculateAggregateTvl(rows).tvl, 100)
    assert.deepEqual(getAggregateTvlStrategyRefs(rows), [])
  })

  it('fetches only requested exposures and resolves lowercase references to canonical storage', async () => {
    await thing(1, parent, 'vault', { yearn: true, v3: true })
    await thing(1, child, 'vault', { yearn: true })
    await thing(1, child, 'strategy')
    await thing(1, strategy, 'strategy')
    await thing(10, strategy, 'strategy')
    await thing(1, missing, 'strategy')
    await snapshot(1, parent, {
      tvl: { close: 100 }, debts: [
        { strategy: child, currentDebtUsd: 30 },
        { strategy, currentDebtUsd: 20 },
        { strategy, currentDebtUsd: 20 },
      ],
    })
    await snapshot(1, child, { tvl: { close: 150 } })
    await snapshot(1, strategy, { aggregateTvlExposures: [exposure], unrelated: 'omit' }, { unused: 'omit' })
    await snapshot(10, strategy, { aggregateTvlExposures: [{ ...exposure, attributableUsd: 999 }] })

    const vaults = await getAggregateVaults(pool!)
    const refs = getAggregateTvlStrategyRefs(vaults)
    assert.deepEqual(refs, [{ chainId: 1, address: strategy.toLowerCase() }])
    const strategies = await getAggregateStrategies([
      ...refs, { chainId: 1, address: strategy }, { chainId: 1, address: missing },
    ], pool!)
    assert.deepEqual(strategies, [{ chainId: 1, address: strategy, hook: { aggregateTvlExposures: [exposure], aggregateTvlTarget: null } }])
    assert.equal(calculateAggregateTvl(vaults, strategies).tvl, 200)
  })

  it('reads strategies that publish only a mapped target', async () => {
    await thing(1, strategy, 'strategy')
    await snapshot(1, strategy, { aggregateTvlTarget: { chainId: 1, address: child } })
    assert.deepEqual(await getAggregateStrategies([{ chainId: 1, address: strategy }], pool!), [{
      chainId: 1, address: strategy,
      hook: { aggregateTvlExposures: null, aggregateTvlTarget: { chainId: 1, address: child } },
    }])
  })

  it('omits absent, empty, or malformed exposures and snapshots without a strategy label', async () => {
    await thing(1, parent, 'strategy')
    await thing(1, child, 'strategy')
    await thing(1, strategy, 'strategy')
    await thing(1, missing, 'vault')
    await snapshot(1, parent, {})
    await snapshot(1, child, { aggregateTvlExposures: [] })
    await snapshot(1, strategy, { aggregateTvlExposures: {} })
    await snapshot(1, missing, { aggregateTvlExposures: [exposure] })
    assert.deepEqual(await getAggregateStrategies(
      [parent, child, strategy, missing].map(address => ({ chainId: 1, address })), pool!,
    ), [])
  })
})
