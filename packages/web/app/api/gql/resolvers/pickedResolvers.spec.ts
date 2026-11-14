import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'
import { infoFor } from '@/lib/requestedFields.fixture'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

const address = '0x0000000000000000000000000000000000000001'

const cases = [
  { name: 'vault', args: { chainId: 1, address }, base: [1, address, 'vault'], source: '{ vault { name } }' },
  { name: 'accountVaults', args: { chainId: 1, account: address }, base: ['vault', 1, JSON.stringify({ roles: [{ account: address }] })], source: '{ accountVaults { name } }' },
  { name: 'strategy', args: { chainId: 1, address }, base: ['strategy', 1, address], source: '{ strategy { name } }' },
  { name: 'vaultStrategies', args: { chainId: 1, vault: address }, base: [1, address], source: '{ vaultStrategies { name } }' },
  { name: 'accountStrategies', args: { chainId: 1, account: address }, base: ['vault', 1, JSON.stringify({ roles: [{ account: address }] }), 'strategy'], source: '{ accountStrategies { name } }' },
  { name: 'accountants', args: { chainId: 1 }, base: ['accountant', 1], source: '{ accountants { name } }' },
  { name: 'accountant', args: { chainId: 1, address }, base: ['accountant', 1, address], source: '{ accountant { name } }' }
]

const modules = {
  vault: () => import('./vault'),
  accountVaults: () => import('./accountVaults'),
  strategy: () => import('./strategy'),
  vaultStrategies: () => import('./vaultStrategies'),
  accountStrategies: () => import('./accountStrategies'),
  accountants: () => import('./accountants'),
  accountant: () => import('./accountant')
}

describe('picked resolvers', () => {
  beforeEach(() => {
    query.mockReset()
  })

  for (const { name, args, base, source } of cases) {
    describe(name, () => {
      it('binds the requested keys last with info', async () => {
        query.mockResolvedValueOnce({ rows: [{ chain_id: 1, address, merged: { name: 'a' } }] })
        const { default: resolver } = await modules[name as keyof typeof modules]()
        const result = await (resolver as (...a: unknown[]) => Promise<unknown>)({}, args, {}, infoFor(source))
        const params = query.mock.calls[0][1] as unknown[]
        const sql = query.mock.calls[0][0] as string
        assert.deepEqual(params, [...base, ['name']])
        assert.match(sql, new RegExp(`WHERE k = ANY\\(\\$${base.length + 1}::text\\[\\]\\)`))
        assert.deepEqual([result].flat(), [{ chainId: 1, address, name: 'a' }])
      })

      it('returns full blobs without info', async () => {
        query.mockResolvedValueOnce({ rows: [] })
        const { default: resolver } = await modules[name as keyof typeof modules]()
        await (resolver as (...a: unknown[]) => Promise<unknown>)({}, args)
        assert.deepEqual(query.mock.calls[0][1], base)
        assert.equal((query.mock.calls[0][0] as string).includes('jsonb_object_agg'), false)
      })
    })
  }
})
