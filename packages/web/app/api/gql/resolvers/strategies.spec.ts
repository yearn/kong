import { strict as assert } from 'node:assert'
import { GraphQLResolveInfo } from 'graphql'
import { beforeEach, describe, it, vi } from 'vitest'
import { infoFor } from '@/lib/requestedFields.fixture'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

const run = async (args: Record<string, unknown>, info?: GraphQLResolveInfo, rows: unknown[] = []) => {
  query.mockResolvedValueOnce({ rows })
  const { default: strategies } = await import('./strategies')
  const result = await strategies({}, args, {}, info)
  return {
    result,
    sql: query.mock.calls[0][0] as string,
    params: query.mock.calls[0][1] as unknown[]
  }
}

describe('strategies resolver', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('binds the requested keys plus the filter keys', async () => {
    const { sql, params } = await run({ chainId: 1 }, infoFor('{ strategies { address name lastReportDetail { apr { net } } } }'))
    assert.deepEqual(params, ['strategy', 1, ['address', 'name', 'lastReportDetail', 'apiVersion', 'erc4626']])
    assert.match(sql, /jsonb_object_agg\(k, v\)/)
    assert.match(sql, /WHERE k = ANY\(\$3::text\[\]\)/)
  })

  it('returns full blobs without info', async () => {
    const { sql, params } = await run({ chainId: 1 })
    assert.deepEqual(params, ['strategy', 1])
    assert.equal(sql.includes('jsonb_object_agg'), false)
  })

  it('keeps ordering by hook totalDebtUsd and filters on the picked keys', async () => {
    const rows = [
      { chain_id: 1, address: '0xa', merged: { name: 'a', apiVersion: '3.0.1', erc4626: true } },
      { chain_id: 1, address: '0xb', merged: { name: 'b', apiVersion: '0.4.6', erc4626: false } }
    ]
    const { sql, result } = await run({ apiVersion: '3.0.0', erc4626: true }, infoFor('{ strategies { name } }'), rows)
    assert.match(sql, /ORDER BY snapshot\.hook->>'totalDebtUsd' DESC/)
    assert.deepEqual(result, [{ chainId: 1, address: '0xa', name: 'a', apiVersion: '3.0.1', erc4626: true }])
  })
})
