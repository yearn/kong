import { describe, expect, it, vi } from 'vitest'
const { query, release } = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }))
vi.mock('../db', () => ({
  default: { connect: async () => ({ query, release }) },
  firstRow: vi.fn(), getTravelledStrides: vi.fn(), toUpsertSql: vi.fn(() => 'INSERT output'), upsertThingDefaults: vi.fn()
}))
import Load from './index'
const output = { chainId: 1, address: '0x0000000000000000000000000000000000000001', label: 'apr', value: 1, blockNumber: 1n, blockTime: 1n }
describe('output queue compatibility', () => {
  it.each([output, { batch: [output] }])('persists current and queued legacy payloads', async payload => {
    query.mockClear()
    await new Load().handlers.output(payload)
    expect(query).toHaveBeenCalledWith('INSERT output', expect.arrayContaining([1, output.address, 'apr']))
    expect(query).toHaveBeenCalledWith('COMMIT')
  })
})
