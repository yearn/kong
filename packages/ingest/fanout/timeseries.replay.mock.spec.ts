import { describe, expect, it, vi } from 'vitest'
import type { AbiHook, HookOutputGroup } from '../abis/types'

const { queryMock, mqAdd, blockTimes, hookSet, pairedProcessor, secondProcessor } = vi.hoisted(() => {
  process.env.TVL_GROUPED_JOBS = 'true'
  return {
    queryMock: vi.fn<(query: string, params: unknown[]) => Promise<{ rows: { day: string }[] }>>(async () => ({ rows: [] })),
    mqAdd: vi.fn<(job: unknown, data: Record<string, unknown>, options: unknown) => Promise<void>>(async () => undefined),
    blockTimes: {} as Record<string, bigint>,
    hookSet: { hooks: [] as AbiHook[] },
    pairedProcessor: vi.fn(async () => []),
    secondProcessor: vi.fn(async () => [])
  }
})

vi.mock('../db', () => ({
  default: { query: queryMock }
}))

vi.mock('lib', () => ({
  math: { max: (...args: bigint[]) => args.reduce((a, b) => (a > b ? a : b)) },
  mq: {
    add: mqAdd,
    job: {
      fanout: { timeseries: { queue: 'fanout', name: 'timeseries' } },
      extract: { timeseries: { queue: 'extract', name: 'timeseries', bychain: true } }
    }
  },
  multicall3: { getActivation: vi.fn(() => 0n) }
}))

vi.mock('lib/blocks', () => ({
  getBlockNumber: vi.fn(async () => 3n),
  getBlockTime: vi.fn(async (_chainId: number, blockNumber: bigint) => blockTimes[blockNumber.toString()]),
  getDefaultStartBlockNumber: vi.fn(async () => 0n)
}))

vi.mock('../abis', () => ({
  requireHooks: vi.fn(async () => () => hookSet.hooks)
}))

import TimeseriesFanout from './timeseries'
import { endOfStringDay } from 'lib/dates'

const CHAIN_ID = 1
const ADDRESS = '0x1111111111111111111111111111111111111111' as const

const DAY1 = endOfStringDay('2024-01-01')
const DAY2 = endOfStringDay('2024-01-02')
const DAY3 = endOfStringDay('2024-01-03')

blockTimes['1'] = DAY1
blockTimes['3'] = DAY3

function source(overrides: Partial<{ startBlock: bigint, endBlock: bigint }> = {}) {
  return { chainId: CHAIN_ID, address: ADDRESS, inceptBlock: 0n, skip: false, only: false, startBlock: 1n, endBlock: 3n, ...overrides }
}

function abi() {
  return { abiPath: 'yearn/lib', sources: [], skip: false, only: false }
}

function singleHook(): AbiHook {
  return { type: 'timeseries', abiPath: 'yearn/lib', module: { outputLabel: 'tvl', default: vi.fn() } }
}

function groupedHook(outputLabel: string, process: HookOutputGroup['process'] = pairedProcessor): AbiHook {
  return {
    type: 'timeseries',
    abiPath: 'yearn/lib',
    module: {
      outputLabel,
      default: vi.fn(),
      outputGroup: { key: 'yearn-tvl', labels: ['tvl', 'tvl-c'], process }
    }
  }
}

describe('TimeseriesFanout replay', () => {
  beforeEach(() => {
    hookSet.hooks = [singleHook()]
  })

  it('replay enqueues every day in range, bypassing the anti-join', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: abi(), source: source(), replay: { enabled: true } })

    expect(mqAdd).toHaveBeenCalledTimes(3)
    expect(queryMock).not.toHaveBeenCalled()

    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY1, DAY2, DAY3])
  })

  it('replay honours since', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: abi(), source: source(), replay: { enabled: true, since: DAY2 } })

    expect(mqAdd).toHaveBeenCalledTimes(2)
    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY2, DAY3])
  })

  it('a normal cycle uses the anti-join', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()
    queryMock.mockResolvedValueOnce({ rows: [{ day: DAY1.toString() }, { day: DAY3.toString() }] })

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: abi(), source: source() })

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).toHaveBeenCalledTimes(2)
    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY1, DAY3])
  })

  it('groups compatible hooks and includes only labels missing on each day', async () => {
    hookSet.hooks = [groupedHook('tvl'), groupedHook('tvl-c')]
    mqAdd.mockClear()
    queryMock.mockClear()
    queryMock
      .mockResolvedValueOnce({ rows: [{ day: DAY1.toString() }] })
      .mockResolvedValueOnce({ rows: [{ day: DAY2.toString() }] })

    await new TimeseriesFanout().fanout({ abi: abi(), source: source() })

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls.map(call => call[1][2])).to.deep.equal(['tvl', 'tvl-c'])
    expect(mqAdd.mock.calls.map(call => [call[1].blockTime, call[1].outputLabels])).to.deep.equal([
      [DAY1, ['tvl']],
      [DAY3, ['tvl', 'tvl-c']],
      [DAY2, ['tvl-c']]
    ])
  })

  it('groups replay ranges while bypassing the label-specific anti-join', async () => {
    hookSet.hooks = [groupedHook('tvl'), groupedHook('tvl-c')]
    mqAdd.mockClear()
    queryMock.mockClear()

    await new TimeseriesFanout().fanout({
      abi: abi(), source: source(), replay: { enabled: true, since: DAY2 }
    })

    expect(queryMock).not.toHaveBeenCalled()
    expect(mqAdd.mock.calls.map(call => [call[1].blockTime, call[1].outputLabels])).to.deep.equal([
      [DAY2, ['tvl', 'tvl-c']],
      [DAY3, ['tvl', 'tvl-c']]
    ])
  })

  it('does not merge hooks that only reuse a group name but use different processors', async () => {
    hookSet.hooks = [groupedHook('tvl'), groupedHook('tvl-c', secondProcessor)]
    mqAdd.mockClear()
    queryMock.mockClear()

    await new TimeseriesFanout().fanout({ abi: abi(), source: source() })

    expect(mqAdd).toHaveBeenCalledTimes(2)
    expect(mqAdd.mock.calls.map(call => call[1].outputLabels)).to.deep.equal([['tvl'], ['tvl-c']])
  })

  it('uses the same grouped jobId regardless of label order', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()
    const run = async (hooks: AbiHook[]) => {
      hookSet.hooks = hooks
      mqAdd.mockClear()
      await new TimeseriesFanout().fanout({ abi: abi(), source: source(), replay: { enabled: true, since: DAY3 } })
      return mqAdd.mock.calls.map(call => (call[2] as { jobId: string }).jobId)
    }
    const forward = await run([groupedHook('tvl'), groupedHook('tvl-c')])
    const reversed = await run([groupedHook('tvl-c'), groupedHook('tvl')])
    expect(forward).to.have.length(1)
    expect(reversed).to.deep.equal(forward)
    expect(forward[0]).to.contain('tvl_tvl-c')
  })

  it('throws when a hook outputLabel is not declared by its group', async () => {
    hookSet.hooks = [groupedHook('bogus')]
    await expect(new TimeseriesFanout().fanout({ abi: abi(), source: source() })).rejects.toThrow('is not declared by output group')
  })
})
