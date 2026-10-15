import { strict as assert } from 'node:assert'
import { vaultLabels } from './timeseries/labels'

const cronDb = { tag: 'cron' }
const getVaultsWithSnapshots = vi.fn()
const getTimeseriesVaults = vi.fn()
const getRecentTimeseries = vi.fn()
const getFullTimeseries = vi.fn()
const getScopedTimeseriesPairs = vi.fn()
const getTrancheSystems = vi.fn()
const getReportsVaults = vi.fn()
const getStrategyReports = vi.fn()
const getRecentStrategyReports = vi.fn()
const cacheMSet = vi.fn().mockResolvedValue(undefined)

vi.mock('../db/cron', () => ({ cronDb }))
vi.mock('./list/db', () => ({ getVaultsWithSnapshots }))
vi.mock('./timeseries/db', () => ({
  getVaults: getTimeseriesVaults,
  getRecentTimeseries,
  getFullTimeseries,
  getScopedTimeseriesPairs,
}))
vi.mock('./tranche/db', () => ({ getTrancheSystems }))
vi.mock('./reports/db', () => ({
  getVaults: getReportsVaults,
  getStrategyReports,
  getRecentStrategyReports,
}))
vi.mock('./cache', () => ({ cacheMSet }))

const VAULT = { chainId: 1, address: '0x0000000000000000000000000000000000000001' }

describe('refresh jobs pass cronDb into db helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getVaultsWithSnapshots.mockResolvedValue([])
    getTimeseriesVaults.mockResolvedValue([VAULT])
    getRecentTimeseries.mockResolvedValue([])
    getFullTimeseries.mockResolvedValue([])
    getScopedTimeseriesPairs.mockResolvedValue([])
    getTrancheSystems.mockResolvedValue([])
    getReportsVaults.mockResolvedValue([VAULT])
    getStrategyReports.mockResolvedValue([{ transactionHash: '0x1' }])
    getRecentStrategyReports.mockResolvedValue([{ transactionHash: '0x1' }])
  })

  it('refresh-vaults', async () => {
    const { refresh } = await import('./refresh-vaults')
    await refresh()
    assert.equal(getVaultsWithSnapshots.mock.calls.length, 1)
    assert.equal(getVaultsWithSnapshots.mock.calls[0][0], cronDb)
  })

  it('timeseries refreshLatest', async () => {
    const { refreshLatest } = await import('./timeseries/refresh')
    await refreshLatest()
    assert.equal(getTimeseriesVaults.mock.calls[0][0], cronDb)
    assert.equal(getRecentTimeseries.mock.calls.length, vaultLabels.length)
    for (const args of getRecentTimeseries.mock.calls) {
      assert.equal(args[3], cronDb)
    }
    assert.deepEqual(getScopedTimeseriesPairs.mock.calls[0].slice(0, 1), [getRecentTimeseries])
    assert.equal(getScopedTimeseriesPairs.mock.calls[0][2], cronDb)
  })

  it('timeseries refreshHistorical', async () => {
    const { refreshHistorical } = await import('./timeseries/refresh-historical')
    await refreshHistorical()
    assert.equal(getTimeseriesVaults.mock.calls[0][0], cronDb)
    assert.equal(getFullTimeseries.mock.calls.length, vaultLabels.length)
    for (const args of getFullTimeseries.mock.calls) {
      assert.equal(args[3], cronDb)
    }
    assert.deepEqual(getScopedTimeseriesPairs.mock.calls[0].slice(0, 1), [getFullTimeseries])
    assert.equal(getScopedTimeseriesPairs.mock.calls[0][2], cronDb)
  })

  it('tranche refreshTranches', async () => {
    const { refreshTranches } = await import('./tranche/refresh')
    await refreshTranches()
    assert.equal(getTrancheSystems.mock.calls[0][0], cronDb)
  })

  it('reports refreshLatest', async () => {
    const { refreshLatest } = await import('./reports/refresh')
    await refreshLatest()
    assert.equal(getReportsVaults.mock.calls[0][0], cronDb)
    assert.deepEqual(getRecentStrategyReports.mock.calls[0], [VAULT.chainId, VAULT.address, cronDb])
  })

  it('reports refreshHistorical', async () => {
    const { refreshHistorical } = await import('./reports/refresh-historical')
    await refreshHistorical()
    assert.equal(getReportsVaults.mock.calls[0][0], cronDb)
    assert.deepEqual(getStrategyReports.mock.calls[0], [VAULT.chainId, VAULT.address, cronDb])
  })
})
