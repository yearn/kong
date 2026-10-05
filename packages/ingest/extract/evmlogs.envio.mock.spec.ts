import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toEventSelector } from 'viem'

const { mqAdd, getLogs, fetchEnvioLogs, covered } = vi.hoisted(() => ({
  mqAdd: vi.fn(), getLogs: vi.fn(), fetchEnvioLogs: vi.fn(), covered: vi.fn()
}))
vi.mock('lib', () => ({ mq: { add: mqAdd, job: { load: { evmlog: {} } }, LOWEST_PRIORITY: 0 } }))
vi.mock('lib/blocks', () => ({ getBlockTime: vi.fn(async () => 1n), getDefaultStartBlockNumber: vi.fn(async () => 0n) }))
vi.mock('../rpcs', () => ({ rpcs: { next: () => ({ getLogs }) } }))
vi.mock('../db', () => ({ default: { query: vi.fn() } }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: vi.fn(async () => ({ success: false })) }))
vi.mock('../abis', () => ({ requireHooks: async () => () => [] }))
vi.mock('../envio', async importOriginal => ({
  ...await importOriginal<typeof import('../envio')>(), fetchEnvioLogs, isEnvioSourceCovered: covered
}))

import { EvmLogsExtractor } from './evmlogs'
const address = '0x0000000000000000000000000000000000000002'
const job = { abiPath: 'yearn/3/vault', chainId: 1, address, from: 1n, to: 9n }
const signature = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
const log = { address, eventName: 'StrategyChanged', topics: [signature], args: {},
  blockNumber: 1n, blockTime: 1n, logIndex: 1, transactionHash: '0x01', transactionIndex: 0 }

describe('Envio extraction coverage', () => {
  beforeEach(() => { vi.clearAllMocks(); covered.mockReturnValue(true); getLogs.mockResolvedValue([]) })

  it('fetches unmapped ABI events from RPC alongside Envio events', async () => {
    fetchEnvioLogs.mockResolvedValue([log])
    await new EvmLogsExtractor().extract(job)
    const rpcEvents = getLogs.mock.calls[0][0].events.map((event: never) => toEventSelector(event))
    expect(rpcEvents).toContain(toEventSelector('event RoleSet(address indexed account, uint256 role)'))
    expect(rpcEvents).not.toContain(signature)
    expect(mqAdd.mock.calls[0][1].batch).toHaveLength(1)
  })

  it('verifies an empty Envio result using the full requested RPC event set', async () => {
    fetchEnvioLogs.mockResolvedValue([])
    getLogs.mockResolvedValue([log])
    await new EvmLogsExtractor().extract(job)
    expect(getLogs.mock.calls[0][0].events.map((event: never) => toEventSelector(event))).toContain(signature)
    expect(mqAdd.mock.calls[0][1].batch).toHaveLength(1)
  })

  it('uses only RPC for unconfirmed sources', async () => {
    covered.mockReturnValue(false)
    await new EvmLogsExtractor().extract(job)
    expect(fetchEnvioLogs).not.toHaveBeenCalled()
    expect(getLogs).toHaveBeenCalledOnce()
  })

  it('does not persist coverage after an Envio failure', async () => {
    fetchEnvioLogs.mockRejectedValue(new Error('bad response'))
    await expect(new EvmLogsExtractor().extract(job)).rejects.toThrow('bad response')
    expect(mqAdd).not.toHaveBeenCalled()
  })
})
