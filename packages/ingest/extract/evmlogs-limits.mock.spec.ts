import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    abi: [
      { name: 'Transfer', type: 'event' },
      { name: 'StrategyChanged', type: 'event' }
    ] as { name: string, type: string }[],
    getLogs: vi.fn(async (_params: Record<string, unknown>) => []),
    mqAdd: vi.fn(async (_job: unknown, _data: Record<string, unknown>, _options: unknown) => undefined),
    dbQuery: vi.fn(async () => ({ rows: [] as unknown[] })),
    defaultStart: vi.fn(async () => 105n)
  }
}))

vi.mock('../rpcs', () => ({
  rpcs: { next: vi.fn(() => ({ getLogs: state.getLogs })) }
}))

vi.mock('lib', () => ({
  math: { div: vi.fn(() => 1n) },
  mq: {
    add: state.mqAdd,
    LOWEST_PRIORITY: 1,
    job: { load: { evmlog: { name: 'evmlog' } } }
  }
}))

vi.mock('lib/blocks', () => ({
  getBlockTime: vi.fn(async () => 1n),
  getDefaultStartBlockNumber: state.defaultStart
}))

vi.mock('../db', () => ({ default: { query: state.dbQuery } }))
vi.mock('../abis', () => ({ requireHooks: vi.fn(async () => () => []) }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: vi.fn(async () => ({ success: false })) }))
vi.mock('lib/blacklist', () => ({ default: { events: { ignore: ['Approval'], limit: ['Transfer', 'Deposit', 'Withdraw'] }, addresses: [] } }))
vi.mock('../abiutil', () => ({
  default: {
    load: vi.fn(async () => state.abi),
    events: (abi: { type: string }[]) => abi.filter(event => event.type === 'event'),
    exclude: (names: string[], events: { name: string }[]) => events.filter(event => !names.includes(event.name))
  }
}))

import { EvmLogsExtractor } from './evmlogs'

const base = {
  abiPath: 'yearn/3/vault',
  chainId: 1,
  address: '0x0000000000000000000000000000000000000483' as const,
  from: 90n,
  to: 110n
}

beforeEach(() => {
  state.getLogs.mockClear()
  state.mqAdd.mockClear()
  state.dbQuery.mockClear()
  state.defaultStart.mockClear()
  state.abi = [
    { name: 'Transfer', type: 'event' },
    { name: 'StrategyChanged', type: 'event' }
  ]
})

describe('event extraction history floor', () => {
  it('uses the fanout-pinned floor when the extractor runs later', async () => {
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => []

    await extractor.extract({ ...base, limitStartBlock: 100n })

    expect(state.defaultStart).not.toHaveBeenCalled()
    expect(state.getLogs).toHaveBeenCalledTimes(2)
    expect(state.getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 90n, toBlock: 99n, events: [{ name: 'StrategyChanged' }] })
    expect(state.getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 100n, toBlock: 110n, events: [{ name: 'Transfer' }, { name: 'StrategyChanged' }] })
  })

  it('falls back to the current floor for legacy jobs without a pin', async () => {
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => []

    await extractor.extract(base)

    expect(state.defaultStart).toHaveBeenCalledWith(1)
    expect(state.getLogs).toHaveBeenCalledTimes(2)
    expect(state.getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 90n, toBlock: 104n })
    expect(state.getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 105n, toBlock: 110n })
  })

  it('does not issue a broad RPC query when the historical event set is empty', async () => {
    state.abi = [{ name: 'Transfer', type: 'event' }]
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => []

    await extractor.extract({ ...base, from: 1n, to: 99n, limitStartBlock: 100n })

    expect(state.getLogs).not.toHaveBeenCalled()
    expect(state.mqAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batch: [], from: 1n, to: 99n }),
      expect.anything()
    )
  })

  it('marks replay loads so the loader does not credit DB-only ranges', async () => {
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => []

    await extractor.extract({ ...base, replay: true })

    expect(state.dbQuery).toHaveBeenCalled()
    expect(state.mqAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ replay: true, from: 90n, to: 110n }),
      expect.anything()
    )
  })
})
