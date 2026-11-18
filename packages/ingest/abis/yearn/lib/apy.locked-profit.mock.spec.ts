import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { block, readContract, multicall, next, first, query, latestBlocks } = vi.hoisted(() => {
  const readContract = vi.fn()
  const multicall = vi.fn()
  const next = vi.fn(() => ({ readContract, multicall }))
  return {
    block: vi.fn(async (_chainId: number, blockNumber?: bigint) => ({
      chainId: 1, number: blockNumber ?? 200n, timestamp: 1_700_000_000n
    })),
    readContract,
    multicall,
    next,
    first: vi.fn(),
    query: vi.fn(),
    latestBlocks: {} as Record<number, { blockNumber: bigint, blockTime: bigint, observedAt: number }>
  }
})

vi.mock('lib/blocks', () => ({
  getBlock: block,
  estimateHeightWithAge: vi.fn(async (_chainId: number, timestamp: bigint) => ({
    height: timestamp === 1_700_000_000n - 7n * 86_400n ? 150n : 120n,
    historical: true
  }))
}))
vi.mock('lib', () => ({
  math: { div: (numerator: bigint, denominator: bigint) => Number(numerator) / Number(denominator) },
  multicall3: { supportsBlock: vi.fn(() => true) }
}))
vi.mock('../../../db', () => ({ first, query }))
vi.mock('../../../rpcs', () => ({ rpcs: { next }, latestBlocks }))
vi.mock('../../../helpers/timeseries-block', () => ({ resolveTimeseriesBlock: vi.fn(async () => 200n) }))
vi.mock('../2/vault/snapshot/hook', () => ({ projectStrategies: vi.fn(async () => []) }))
vi.mock('../3/vault/snapshot/hook', () => ({ projectStrategies: vi.fn(async () => []) }))
vi.mock('../2/strategy/event/hook', () => ({ extractFeesBps: vi.fn(async () => ({ management: 0n, performance: 0n })) }))

import { EvmLogSchema, ThingSchema } from 'lib/types'
import process, { _compute } from './apy'

const ADDRESS = '0x0000000000000000000000000000000000000123' as const
const vault = ThingSchema.parse({
  chainId: 1,
  address: ADDRESS,
  label: 'vault',
  defaults: { apiVersion: '0.4.3', decimals: 6 }
})
const harvests = [100n, 101n].map((blockNumber, index) => EvmLogSchema.parse({
  chainId: 1,
  address: ADDRESS,
  eventName: 'StrategyReported',
  signature: '0x1234',
  topics: [],
  args: {},
  hook: {},
  blockNumber,
  blockTime: 1_600_000_000n + BigInt(index),
  logIndex: index,
  transactionHash: `0x${String(index + 1).padStart(64, '0')}`,
  transactionIndex: 0
}))

describe('Yearn APY locked-profit RPC', () => {
  beforeEach(() => {
    readContract.mockReset().mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => {
      return blockNumber === 200n ? 1200n : blockNumber === 150n ? 1100n : blockNumber === 120n ? 1050n : 1000n
    })
    multicall.mockReset().mockImplementation(async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
      contracts.map(({ functionName }) => ({
        status: 'success', result: functionName === 'lockedProfit' ? 1_000n : 1n
      }))
    )
    next.mockClear()
    block.mockClear()
    first.mockReset().mockResolvedValue(undefined)
    query.mockReset().mockResolvedValue(harvests)
  })

  afterEach(() => vi.restoreAllMocks())

  it('skips lockedProfit reads when computing production timeseries APY', async () => {
    const apy = await _compute(vault, [], 200n, { includeLockedProfit: false })

    expect(apy.lockedProfit).to.equal(undefined)
    expect(multicall.mock.calls.flatMap(([request]) => request.contracts.map((item: { functionName: string }) => item.functionName)))
      .not.to.include('lockedProfit')
  })

  it('keeps lockedProfit in the existing default _compute result', async () => {
    const apy = await _compute(vault, [], 200n)

    expect(apy.lockedProfit).to.equal(1_000n)
    expect(multicall.mock.calls.flatMap(([request]) => request.contracts.map((item: { functionName: string }) => item.functionName)))
      .to.include('lockedProfit')
  })

  it('does not request lockedProfit from the production timeseries processor', async () => {
    first.mockResolvedValue(vault)
    const todayEod = BigInt(Math.floor(Date.now() / 86_400_000) * 86_400 + 86_399)

    const outputs = await process(1, ADDRESS, 'vault', {
      outputLabel: 'apy-bwd-delta-pps',
      blockTime: todayEod,
      isClosedDay: false
    })

    expect(outputs.length).to.be.greaterThan(0)
    expect(multicall.mock.calls.flatMap(([request]) => request.contracts.map((item: { functionName: string }) => item.functionName)))
      .not.to.include('lockedProfit')
  })
})
