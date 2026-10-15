import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

const run = async (args: Record<string, unknown>) => {
  query.mockResolvedValueOnce({ rows: [] })
  const { default: vaults } = await import('./vaults')
  await vaults({}, args)
  return {
    sql: query.mock.calls[0][0] as string,
    params: query.mock.calls[0][1] as unknown[]
  }
}

describe('vaults resolver', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('clamps limit into [1, 1000]', async () => {
    const low = await run({ chainId: 1, limit: -1 })
    assert.equal(low.params.at(-2), 1)

    query.mockReset()
    const high = await run({ chainId: 1, limit: 1_000_000 })
    assert.equal(high.params.at(-2), 1000)

    query.mockReset()
    const dflt = await run({ chainId: 1 })
    assert.equal(dflt.params.at(-2), 100)
  })

  it('clamps offset to zero or more', async () => {
    const negative = await run({ chainId: 1, offset: -5 })
    assert.equal(negative.params.at(-1), 0)

    query.mockReset()
    const dflt = await run({ chainId: 1 })
    assert.equal(dflt.params.at(-1), 0)

    query.mockReset()
    const given = await run({ chainId: 1, offset: 50 })
    assert.equal(given.params.at(-1), 50)
  })

  it('binds limit and offset as the last two params', async () => {
    const { sql, params } = await run({ chainId: 1, limit: 50, offset: 50 })
    assert.match(sql, /LIMIT \$3 OFFSET \$4/)
    assert.deepEqual(params, ['vault', 1, 50, 50])
  })

  it('orders by tvl, then chain, then address', async () => {
    const { sql } = await run({ chainId: 1 })
    assert.equal(sql.includes('ORDER BY COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0) DESC, thing.chain_id ASC, lower(thing.address) ASC'), true)
  })

  it('treats a null chainId like an omitted chainId', async () => {
    const omitted = await run({})
    query.mockReset()
    const nullable = await run({ chainId: null })
    assert.equal(nullable.sql, omitted.sql)
    assert.deepEqual(nullable.params, omitted.params)
  })
})
