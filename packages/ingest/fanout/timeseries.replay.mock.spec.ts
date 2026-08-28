import { describe, expect, it, vi } from 'vitest'

const { queryMock, mqAdd, blockTimes } = vi.hoisted(() => ({
  queryMock: vi.fn(async () => ({ rows: [] as { day: string }[] })),
  mqAdd: vi.fn(async () => undefined),
  blockTimes: {} as Record<string, bigint>
}))

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
  requireHooks: vi.fn(async () => () => [
    { type: 'timeseries', abiPath: 'yearn/lib', module: { outputLabel: 'tvl', default: vi.fn() } }
  ])
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
  return { chainId: CHAIN_ID, address: ADDRESS, inceptBlock: 0n, startBlock: 1n, endBlock: 3n, ...overrides }
}

describe('TimeseriesFanout replay', () => {
  it('replay enqueues every day in range, bypassing the anti-join', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: { abiPath: 'yearn/lib' }, source: source(), replay: { enabled: true } })

    expect(mqAdd).toHaveBeenCalledTimes(3)
    expect(queryMock).not.toHaveBeenCalled()

    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY1, DAY2, DAY3])
  })

  it('replay honours since', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: { abiPath: 'yearn/lib' }, source: source(), replay: { enabled: true, since: DAY2 } })

    expect(mqAdd).toHaveBeenCalledTimes(2)
    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY2, DAY3])
  })

  it('a normal cycle uses the anti-join', async () => {
    mqAdd.mockClear()
    queryMock.mockClear()
    queryMock.mockResolvedValueOnce({ rows: [{ day: DAY1.toString() }, { day: DAY3.toString() }] })

    const fanout = new TimeseriesFanout()
    await fanout.fanout({ abi: { abiPath: 'yearn/lib' }, source: source() })

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(mqAdd).toHaveBeenCalledTimes(2)
    const enqueuedDays = mqAdd.mock.calls.map(call => call[1].blockTime)
    expect(enqueuedDays).to.deep.equal([DAY1, DAY3])
  })
})
