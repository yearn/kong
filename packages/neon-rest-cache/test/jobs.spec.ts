import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVaultsWithSnapshots: vi.fn(),
  getTrancheControllers: vi.fn(),
  getTrancheSystem: vi.fn(),
  getReportVaults: vi.fn(),
  getRecentStrategyReports: vi.fn(),
}))

vi.mock('../../web/app/api/rest/list/db', () => ({
  getVaultsWithSnapshots: mocks.getVaultsWithSnapshots,
}))
vi.mock('../../web/app/api/rest/tranche/db', () => ({
  getTrancheControllers: mocks.getTrancheControllers,
  getTrancheSystem: mocks.getTrancheSystem,
}))
vi.mock('../../web/app/api/rest/reports/db', () => ({
  getVaults: mocks.getReportVaults,
  getRecentStrategyReports: mocks.getRecentStrategyReports,
}))

import { refreshCache } from '../src/jobs/refresh-cache'
import { refreshReports } from '../src/jobs/reports-refresh'

describe('refresh jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails the staged cache refresh when a vault list row fails validation', async () => {
    mocks.getVaultsWithSnapshots.mockResolvedValue([
      { listItem: null, listError: new Error('invalid row'), snapshot: null },
    ])
    mocks.getTrancheControllers.mockResolvedValue([])
    const setMany = vi.fn(async (_pairs: Array<[string, string]>) => {})

    await expect(refreshCache({
      sourceDb: {} as never,
      cache: { getMany: vi.fn(), setMany },
    })).rejects.toThrow(/failed validation/)

    expect(setMany.mock.calls.flatMap(([pairs]) => pairs).some(([key]) => key.startsWith('rest:list:vaults:'))).toBe(false)
  })

  it('serializes report BigInt fields as decimal strings', async () => {
    mocks.getReportVaults.mockResolvedValue([{ chainId: 1, address: '0x0000000000000000000000000000000000000001' }])
    mocks.getRecentStrategyReports.mockResolvedValue([{ gain: 9007199254740993n }])
    const setMany = vi.fn(async (_pairs: Array<[string, string]>) => {})

    await refreshReports({
      sourceDb: {} as never,
      cache: { getMany: vi.fn(), setMany },
    })

    const payload = setMany.mock.calls[0][0][0][1]
    expect(JSON.parse(payload).value[0].gain).toBe('9007199254740993')
  })
})
