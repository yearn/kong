import { describe, expect, it, vi } from 'vitest'
import { toEventSelector } from 'viem'

const { mqAdd, getLogs, dbQuery, yearnHook } = vi.hoisted(() => ({
  mqAdd: vi.fn(async () => undefined),
  getLogs: vi.fn(),
  dbQuery: vi.fn(),
  yearnHook: vi.fn(async () => ({ yearn: true }))
}))

vi.mock('lib', () => ({ mq: { add: mqAdd, job: { load: { evmlog: {} } }, LOWEST_PRIORITY: 0 } }))
vi.mock('lib/blocks', () => ({ getBlockTime: vi.fn(async () => 1n), getDefaultStartBlockNumber: vi.fn(async () => 0n) }))
vi.mock('../rpcs', () => ({ rpcs: { next: () => ({ getLogs }) } }))
vi.mock('../db', () => ({ default: { query: dbQuery } }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: vi.fn(async () => ({ success: false })) }))

const STRATEGY_CHANGED = toEventSelector('event StrategyChanged(address indexed strategy, uint256 indexed change_type)')
const DEPOSIT = toEventSelector('event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)')

vi.mock('../abis', () => ({
  requireHooks: async () => (path: string) => path === 'yearn/3/vault'
    ? [{ type: 'event', abiPath: path, module: { topics: [STRATEGY_CHANGED], default: yearnHook } }]
    : []
}))

import { EvmLogsExtractor } from './evmlogs'

const ADDRESS = '0x0eD92e4225126578791303BF579F2853e7Fdca6B'
const job = { abiPaths: ['erc4626', 'yearn/3/vault'], signatures: [STRATEGY_CHANGED], chainId: 1, address: ADDRESS, from: 0n, to: 9n }

function log(signature: `0x${string}`, logIndex: number) {
  return {
    chainId: 1, address: ADDRESS, eventName: 'x', signature, topics: [signature], args: {}, hook: {},
    blockNumber: 1n, blockTime: 1n, logIndex, transactionHash: '0x01', transactionIndex: 0
  }
}

function loaded() {
  return ((mqAdd.mock.calls.at(-1) as unknown[])[1] as { batch: { signature: string, hook: object }[] }).batch
}

describe('EvmLogsExtractor multi-abi', () => {
  it('fetches only requested signatures and runs every reader\'s hooks', async () => {
    getLogs.mockResolvedValueOnce([log(STRATEGY_CHANGED, 0)])

    await new EvmLogsExtractor().extract(job)

    const { events } = (getLogs.mock.calls[0] as unknown[])[0] as { events: object[] }
    expect(events.map(e => toEventSelector(e as never))).toEqual([STRATEGY_CHANGED])
    expect(yearnHook).toHaveBeenCalledOnce()
    expect(loaded()).toMatchObject([{ signature: STRATEGY_CHANGED, hook: { yearn: true } }])
  })

  it('drops replayed logs outside the requested signatures', async () => {
    dbQuery.mockResolvedValueOnce({ rows: [log(STRATEGY_CHANGED, 0), log(DEPOSIT, 1)] })

    await new EvmLogsExtractor().extract({ ...job, replay: true })

    expect(loaded().map(l => l.signature)).toEqual([STRATEGY_CHANGED])
  })

  it('does not credit signature coverage for an old queued payload', async () => {
    getLogs.mockResolvedValueOnce([])
    await new EvmLogsExtractor().extract({ abiPath: 'erc4626', chainId: 1, address: ADDRESS, from: 0n, to: 9n })
    expect((mqAdd.mock.calls.at(-1) as unknown[])[1]).toMatchObject({ signatures: undefined })
  })

  it('rejects obsolete requested signatures instead of marking them covered', async () => {
    mqAdd.mockClear()
    await expect(new EvmLogsExtractor().extract({ ...job, signatures: ['0xunknown'] }))
      .rejects.toThrow('Requested event signature')
    expect(mqAdd).not.toHaveBeenCalled()
  })
})
