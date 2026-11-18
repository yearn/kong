import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from './route'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../../../cache', () => ({
  getKeyvClient: () => ({ get }),
  lastRefreshHeaders: async () => ({}),
}))

const cutoff = Date.UTC(2025, 10, 19) / 1000
const report = (time: number, logIndex: number) => ({
  blockTime: String(time), transactionHash: '0x1', logIndex,
})
const read = () => GET(new Request('http://localhost/api/rest/reports/1/0x1') as never, {
  params: Promise.resolve({ chainId: '1', address: '0x1' }),
})

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 18, 23))
  get.mockReset()
})
afterEach(() => vi.restoreAllMocks())

it('retains the boundary event and deduplicates reports from the two cache entries', async () => {
  const first = report(cutoff, 1)
  const latest = report(cutoff + 10, 2)
  get.mockResolvedValueOnce([latest, first, report(cutoff - 1, 3)])
    .mockResolvedValueOnce([latest, report(cutoff - 1, 4)])
  expect(await (await read()).json()).toEqual([latest, first])
})

it('returns 404 when even the newest cached report has expired', async () => {
  get.mockResolvedValue([report(cutoff - 1, 0)])
  expect((await read()).status).toBe(404)
})
