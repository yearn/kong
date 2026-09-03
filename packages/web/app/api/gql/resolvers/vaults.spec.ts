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
    assert.equal(low.params.at(-1), 1)

    query.mockReset()
    const high = await run({ chainId: 1, limit: 1_000_000 })
    assert.equal(high.params.at(-1), 1000)

    query.mockReset()
    const dflt = await run({ chainId: 1 })
    assert.equal(dflt.params.at(-1), 100)
  })

  it('advances past the cursor tie group instead of re-serving it', async () => {
    const { sql } = await run({ chainId: 1, after: '0xAbC' })
    const tvl = 'COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0)'
    assert.equal(sql.includes(`${tvl} < (SELECT tvl FROM cursor)`), true)
    assert.equal(sql.includes('lower(thing.address) > (SELECT address FROM cursor)'), true)
    // the row-comparison form admitted every same-tvl row with a smaller address
    assert.equal(sql.includes('thing.address) < (SELECT tvl, address FROM cursor)'), false)
  })

  it('orders on the same expression the cursor compares', async () => {
    const { sql } = await run({ chainId: 1 })
    assert.equal(sql.includes('ORDER BY COALESCE((snapshot.hook->\'tvl\'->>\'close\')::numeric, 0) DESC, lower(thing.address) ASC'), true)
  })

  it('resolves the cursor case-insensitively and binds chainId explicitly', async () => {
    const { sql, params } = await run({ chainId: 10, after: '0xABCDEF' })
    assert.equal(sql.includes('lower(thing.address) = lower($3)'), true)
    assert.equal(sql.includes('$4::int IS NULL OR thing.chain_id = $4::int'), true)
    assert.deepEqual(params, ['vault', 10, '0xABCDEF', 10, 100])
  })

  it('treats omitted chainId as all chains', async () => {
    const { sql, params } = await run({ after: '0xABCDEF' })
    assert.equal(sql.includes('thing.chain_id = $2'), false)
    assert.equal(sql.includes('$3::int IS NULL OR thing.chain_id = $3::int'), true)
    assert.deepEqual(params, ['vault', '0xABCDEF', null, 100])
  })

  it('treats a null chainId like an omitted chainId', async () => {
    const omitted = await run({})
    query.mockReset()
    const nullable = await run({ chainId: null })
    assert.equal(nullable.sql, omitted.sql)
    assert.deepEqual(nullable.params, omitted.params)
  })

  it('uses the chain in an all-chain cursor to disambiguate same-address vaults', async () => {
    const { sql, params } = await run({ after: '10:0xABCDEF' })
    assert.match(sql, /lower\(thing\.address\) = lower\(\$2\)/)
    assert.match(sql, /AND thing\.chain_id = 10/)
    assert.match(sql, /thing\.chain_id > \(SELECT chain_id FROM cursor\)/)
    assert.match(sql, /ORDER BY .*lower\(thing\.address\) ASC, thing\.chain_id ASC/)
    assert.deepEqual(params, ['vault', '0xABCDEF', null, 100])
  })

  it('coalesces one concurrent query and evicts it after success', async () => {
    let resolve: (value: { rows: unknown[] }) => void = () => undefined
    query.mockImplementationOnce(() => new Promise<{ rows: unknown[] }>(r => { resolve = r }))
    const { default: vaults } = await import('./vaults')

    const first = vaults({}, { chainId: 1 })
    const second = vaults({}, { chainId: 1 })
    assert.equal(query.mock.calls.length, 1)
    resolve({ rows: [] })
    await Promise.all([first, second])

    query.mockResolvedValueOnce({ rows: [] })
    await vaults({}, { chainId: 1 })
    assert.equal(query.mock.calls.length, 2)
  })

  it('evicts a rejected query so a retry can run', async () => {
    const { default: vaults } = await import('./vaults')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    query.mockRejectedValueOnce(new Error('temporary'))
    await assert.rejects(vaults({}, { chainId: 1 }))

    query.mockResolvedValueOnce({ rows: [] })
    await vaults({}, { chainId: 1 })
    errorSpy.mockRestore()
    assert.equal(query.mock.calls.length, 2)
  })
})
