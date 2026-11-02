import { expect, it, vi } from 'vitest'
const { query, next, store } = vi.hoisted(() => ({ query: vi.fn(), next: vi.fn(), store: new Map<string, unknown>() }))
vi.mock('./db', () => ({ default: { query } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
vi.mock('lib/cache', () => ({
  cache: {
    wrap: async (key: string, fn: () => Promise<unknown>) => {
      if (store.has(key)) return store.get(key)
      const value = await fn()
      if (value !== undefined && value !== null) store.set(key, value)
      return value
    }
  }
}))
import { fetchDecimals, fetchOrExtractDecimals } from './abis/yearn/lib'
it.each([0, '0'])('uses stored zero decimals (%s) without RPC', async decimals => {
  store.clear()
  query.mockResolvedValue({ rows: [{ decimals }] })
  expect(await fetchOrExtractDecimals(1, '0x0000000000000000000000000000000000000001')).toBe(decimals)
  expect(next).not.toHaveBeenCalled()
})
it('reuses cached decimals without a second query', async () => {
  store.clear()
  query.mockClear()
  query.mockResolvedValue({ rows: [{ decimals: 18 }] })
  expect(await fetchDecimals(1, '0x00000000000000000000000000000000000000Ab')).toBe(18)
  expect(await fetchDecimals(1, '0x00000000000000000000000000000000000000ab')).toBe(18)
  expect(query).toHaveBeenCalledTimes(1)
})
it('falls back to RPC when no thing row exists', async () => {
  store.clear()
  query.mockResolvedValue({ rows: [] })
  const readContract = vi.fn().mockResolvedValue(6n)
  next.mockReturnValue({ readContract })
  expect(await fetchOrExtractDecimals(1, '0x0000000000000000000000000000000000000003')).toBe(6)
  expect(readContract).toHaveBeenCalledTimes(1)
})
