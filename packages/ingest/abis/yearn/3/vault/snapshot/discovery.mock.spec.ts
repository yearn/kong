import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'

const { query, travelled, add, countMetric, captureMessage, next, readContract, confirm } = vi.hoisted(() => ({
  query: vi.fn(), travelled: vi.fn(), add: vi.fn(), captureMessage: vi.fn(), countMetric: vi.fn(), next: vi.fn(), readContract: vi.fn(), confirm: vi.fn()
}))
vi.mock('../../../../../db', () => ({ default: { query }, getSparkline: vi.fn(), getTravelledStrides: travelled }))
vi.mock('../../../../../rpcs', () => ({ rpcs: { next } }))
vi.mock('../../../../../prices', () => ({ fetchErc20PriceUsd: vi.fn() }))
vi.mock('lib', async importOriginal => ({
  ...await importOriginal<typeof import('lib')>(),
  mq: { add, confirmDiscoveryRepair: confirm, job: { fanout: { events: { name: 'events', queue: 'fanout' } } } },
  sentry: { captureMessage, countMetric }, abisConfig: { abis: [{ abiPath: 'yearn/3/vault' }] }
}))
import { projectStrategies, SnapshotSchema } from './hook'

const vault = '0x0000000000000000000000000000000000000001'
const strategy = '0x0ed92e4225126578791303bf579f2853e7fdca6b'
const snapshot = SnapshotSchema.parse({ blockNumber: 100n, get_default_queue: [getAddress(strategy)] })

describe('vault discovery repair', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    next.mockReturnValue({ readContract })
    readContract.mockResolvedValue([])
    travelled.mockResolvedValue([{ from: 1n, to: 100n }])
    query.mockResolvedValue({ rows: [] })
  })

  it('refetches real logs from inception when covered history is missing a queued strategy', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ inceptBlock: '1' }] })
    expect(await projectStrategies(1, vault, undefined, snapshot)).toEqual([getAddress(strategy)])
    expect(captureMessage).toHaveBeenCalledWith('DISCOVERY_GAP', expect.any(Object))
    expect(add).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      ignoreStrides: true, source: { chainId: 1, address: vault, inceptBlock: '1' }
    }), expect.objectContaining({ jobId: `fanout-events-repair-1-${vault}`, removeOnComplete: true, removeOnFail: true, attempts: 1 }))
  })

  it('does not repair a contract whose initial logs have not loaded', async () => {
    travelled.mockResolvedValue(undefined)
    await projectStrategies(1, vault, undefined, snapshot)
    expect(add).not.toHaveBeenCalled()
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it.each([
    { coverage: [{ from: 1n, to: 99n }] },
    { coverage: [{ from: 1n, to: 50n }, { from: 52n, to: 100n }] }
  ])('does not repair while event history is incomplete: %j', async ({ coverage }) => {
    travelled.mockResolvedValue(coverage)
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ inceptBlock: '1' }] })
    await projectStrategies(1, vault, undefined, snapshot)
    expect(add).not.toHaveBeenCalled()
    expect(captureMessage).not.toHaveBeenCalled()
    expect(countMetric).toHaveBeenCalledWith('discovery_gap.deferred', 1, { chainId: '1', reason: 'awaiting_event_coverage' })
  })

  it('repairs a permanent gap while ingestion trails the snapshot head', async () => {
    travelled.mockResolvedValue([{ from: 1n, to: 99n }])
    readContract.mockResolvedValue([strategy])
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ inceptBlock: '1' }] }).mockResolvedValueOnce({ rows: [] })
    await projectStrategies(1, vault, undefined, snapshot)
    expect(next).toHaveBeenCalledWith(1, 99n)
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 99n, functionName: 'get_default_queue' }))
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [1, vault, expect.any(String), 99n])
    expect(captureMessage).toHaveBeenCalledWith('DISCOVERY_GAP', expect.objectContaining({ extra: expect.objectContaining({ comparisonBlock: '99', snapshotBlock: '100' }) }))
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('reports an archival detector error while preserving the snapshot strategy list', async () => {
    travelled.mockResolvedValue([{ from: 1n, to: 99n }])
    const error = new Error('archive unavailable')
    error.name = 'ContractFunctionExecutionError'
    readContract.mockRejectedValueOnce(error)
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ inceptBlock: '1' }] })
    expect(await projectStrategies(1, vault, undefined, snapshot)).toEqual([getAddress(strategy)])
    expect(captureMessage).toHaveBeenCalledWith('DISCOVERY_GAP_CHECK_FAILED', expect.objectContaining({ level: 'error', extra: expect.objectContaining({ error: 'ContractFunctionExecutionError: archive unavailable' }) }))
    expect(add).not.toHaveBeenCalled()
  })

  it('does not confirm a repair from an empty queue', async () => {
    await projectStrategies(1, vault, 100n, SnapshotSchema.parse({ blockNumber: 100n, get_default_queue: [] }))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not alert without a pinned snapshot block', async () => {
    await projectStrategies(1, vault, undefined, { get_default_queue: [getAddress(strategy)] })
    expect(add).not.toHaveBeenCalled()
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('does not invent a gap due to address case or an unrelated revoke', async () => {
    query.mockResolvedValue({ rows: [
      { strategy, change_type: '1' },
      { strategy: vault, change_type: '2' }
    ] })
    expect(await projectStrategies(1, vault, undefined, snapshot)).toEqual([getAddress(strategy)])
    expect(add).not.toHaveBeenCalled()
    expect(travelled).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(1, vault, 100n)
  })
})
