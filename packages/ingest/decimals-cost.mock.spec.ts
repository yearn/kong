import { expect, it, vi } from 'vitest'
const { query, next } = vi.hoisted(() => ({ query: vi.fn(), next: vi.fn() }))
vi.mock('./db', () => ({ default: { query } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
import { fetchOrExtractDecimals } from './abis/yearn/lib'
it.each([0, '0'])('uses stored zero decimals (%s) without RPC', async decimals => {
  query.mockResolvedValue({ rows: [{ decimals }] })
  expect(await fetchOrExtractDecimals(1, '0x0000000000000000000000000000000000000001')).toBe(decimals)
  expect(next).not.toHaveBeenCalled()
})
