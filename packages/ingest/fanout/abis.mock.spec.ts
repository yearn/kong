import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbiConfig } from 'lib/abis'
import type { BulkJob } from 'lib/mq'
import type { Thing } from 'lib/types'

const { abis, queued, addBulk, getThings, collect, flush } = vi.hoisted(() => {
  const queued: BulkJob[] = []
  return {
    abis: [] as AbiConfig[], queued,
    addBulk: vi.fn(async (jobs: Iterable<BulkJob>) => { queued.push(...jobs) }),
    getThings: vi.fn(async (): Promise<Thing[]> => []),
    collect: vi.fn(), flush: vi.fn()
  }
})
vi.mock('lib', () => ({
  abisConfig: { abis }, chains: [{ id: 1 }], sentry: {},
  mq: {
    add: vi.fn(), addBulk,
    job: {
      extract: { manuals: { name: 'manuals' }, snapshot: { name: 'snapshot' } },
      fanout: { events: { name: 'events' }, timeseries: { name: 'timeseries' } }
    }
  }
}))
vi.mock('../things', () => ({ get: getThings }))
vi.mock('../prices', () => ({ clearNegativePriceCache: vi.fn() }))
vi.mock('./isBusy', () => ({ findBusyMatch: vi.fn(async () => null) }))
vi.mock('./webhooks', () => ({ default: class { collect = collect; flush = flush } }))

import AbisFanout from './abis'
import { AbiConfigSchema } from 'lib/abis'

const source = { chainId: 1, address: '0x1111111111111111111111111111111111111111', inceptBlock: 1n }

beforeEach(() => {
  vi.clearAllMocks()
  queued.length = 0
  abis.length = 0
  getThings.mockResolvedValue([])
  collect.mockReset()
})

describe('ABI fanout batching', () => {
  it('preserves earlier jobs when a later thing lookup fails', async () => {
    abis.push(AbiConfigSchema.parse({ abiPath: 'x', sources: [source], things: { label: 'vault', filter: [] } }))
    const failure = new Error('thing lookup failed')
    getThings.mockRejectedValueOnce(failure)
    await expect(new AbisFanout().fanout({})).rejects.toBe(failure)
    expect(queued.map(({ job }) => job.name)).toEqual(['events', 'snapshot', 'timeseries'])
    expect(flush).not.toHaveBeenCalled()
  })

  it('preserves produced jobs when collecting a later source fails', async () => {
    abis.push(AbiConfigSchema.parse({ abiPath: 'x', sources: [source, { ...source, inceptBlock: 2n }] }))
    const failure = new Error('invalid source')
    collect.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw failure })
    await expect(new AbisFanout().fanout({})).rejects.toBe(failure)
    expect(queued).toHaveLength(6)
    expect(queued[0].data.source.inceptBlock).toBe(1n)
    expect(flush).not.toHaveBeenCalled()
  })

  it('flushes bounded buffers while traversing sources', async () => {
    abis.push(AbiConfigSchema.parse({ abiPath: 'x', sources: Array.from({ length: 800 }, () => source) }))
    await new AbisFanout().fanout({})
    expect(addBulk.mock.calls.map(([jobs]) => [...jobs].length)).toEqual([999, 999, 402])
    expect(queued).toHaveLength(2400)
    expect(flush).toHaveBeenCalledOnce()
  })
})
