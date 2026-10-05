import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toEventSelector } from 'viem'

const { mqAdd, getLogs, fetchEnvioLogs, covered, invalidate, hook } = vi.hoisted(() => ({
  mqAdd: vi.fn(), getLogs: vi.fn(), fetchEnvioLogs: vi.fn(), covered: vi.fn(), invalidate: vi.fn(), hook: vi.fn(async () => ({}))
}))
vi.mock('lib', () => ({ mq: { add: mqAdd, job: { load: { evmlog: {} } }, LOWEST_PRIORITY: 0 } }))
vi.mock('lib/blocks', () => ({ getBlockTime: vi.fn(async () => 1n), getDefaultStartBlockNumber: vi.fn(async () => 0n) }))
vi.mock('../rpcs', () => ({ rpcs: { next: () => ({ getLogs }) } }))
vi.mock('../db', () => ({ default: { query: vi.fn() } }))
vi.mock('../abis/yearn/lib', () => ({ safeFetchOrExtractDecimals: vi.fn(async () => ({ success: false })) }))
vi.mock('../abis', () => ({ requireHooks: async () => () => [{ module: { topics: [signature], default: hook } }] }))
vi.mock('../envio', async importOriginal => ({
  ...await importOriginal<typeof import('../envio')>(), fetchEnvioLogs, isEnvioSourceTrusted: covered, invalidateEnvioSource: invalidate
}))

import { EvmLogsExtractor } from './evmlogs'
import { EnvioLagError } from '../envio'
const address = '0x0000000000000000000000000000000000000002'
const job = { abiPath: 'yearn/3/vault', chainId: 1, address, from: 1n, to: 9n }
const signature = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
const log = { address, eventName: 'StrategyChanged', topics: [signature], args: {},
  blockNumber: 1n, blockTime: 1n, logIndex: 1, transactionHash: '0x01', transactionIndex: 0 }

describe('Envio extraction coverage', () => {
  beforeEach(() => { vi.clearAllMocks(); covered.mockReturnValue(true); invalidate.mockResolvedValue(undefined); getLogs.mockResolvedValue([]) })

  it('fetches unmapped ABI events from RPC alongside Envio events', async () => {
    fetchEnvioLogs.mockResolvedValue([log])
    await new EvmLogsExtractor().extract(job)
    const rpcEvents = getLogs.mock.calls[0][0].events.map((event: never) => toEventSelector(event))
    expect(rpcEvents).toContain(toEventSelector('event RoleSet(address indexed account, uint256 role)'))
    expect(rpcEvents).not.toContain(signature)
    expect(rpcEvents).toContain(toEventSelector('event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)'))
    expect(mqAdd.mock.calls[0][1].batch).toHaveLength(1)
  })

  it('verifies an empty Envio result using the full requested RPC event set', async () => {
    const warning = vi.spyOn(console, 'warn')
    fetchEnvioLogs.mockResolvedValue([])
    getLogs.mockResolvedValue([log])
    await new EvmLogsExtractor().extract(job)
    expect(getLogs.mock.calls[0][0].events.map((event: never) => toEventSelector(event))).toContain(signature)
    expect(warning).toHaveBeenCalledWith('ENVIO_EMPTY_RPC_MISMATCH', expect.any(Object))
    warning.mockRestore()
    expect(mqAdd.mock.calls[0][1].batch).toHaveLength(1)
  })

  it('uses RPC for the next chunk once an empty-result mismatch revokes the source', async () => {
    fetchEnvioLogs.mockResolvedValue([])
    getLogs.mockResolvedValue([log])
    invalidate.mockImplementationOnce(async () => { covered.mockReturnValue(false) })
    await new EvmLogsExtractor().extract(job)
    await new EvmLogsExtractor().extract({ ...job, from: 10n, to: 19n })
    expect(fetchEnvioLogs).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith(1, address, job.abiPath)
    expect(getLogs).toHaveBeenCalledTimes(2)
  })

  it('fails before persistence if the source revocation cannot be stored', async () => {
    fetchEnvioLogs.mockResolvedValue([]); getLogs.mockResolvedValue([log])
    invalidate.mockRejectedValueOnce(new Error('redis unavailable'))
    await expect(new EvmLogsExtractor().extract(job)).rejects.toThrow('redis unavailable')
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('checks a sibling mapped event even when another entity returned rows', async () => {
    const depositSignature = toEventSelector('event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)')
    fetchEnvioLogs.mockResolvedValue([log])
    getLogs.mockResolvedValue([{ ...log, eventName: 'Deposit', topics: [depositSignature], logIndex: 2 }])
    const warning = vi.spyOn(console, 'warn')
    try {
      await new EvmLogsExtractor().extract(job)
      expect(getLogs.mock.calls[0][0].events.map((event: never) => toEventSelector(event))).toContain(depositSignature)
      expect(warning).toHaveBeenCalledWith('ENVIO_EMPTY_RPC_MISMATCH', expect.any(Object))
      expect(mqAdd.mock.calls[0][1].batch).toHaveLength(2)
    } finally { warning.mockRestore() }
  })

  it('attaches the same timestamp before hooks on the RPC path', async () => {
    covered.mockReturnValue(false)
    const rpcLog = { ...log, blockTime: undefined }
    getLogs.mockResolvedValue([rpcLog])
    await new EvmLogsExtractor().extract(job)
    expect(hook).toHaveBeenCalledWith(1, address, expect.objectContaining({ blockTime: 1n }))
  })

  it('uses only RPC for unconfirmed sources', async () => {
    covered.mockReturnValue(false)
    await new EvmLogsExtractor().extract(job)
    expect(fetchEnvioLogs).not.toHaveBeenCalled()
    expect(getLogs).toHaveBeenCalledOnce()
  })

  it('distinguishes routine watermark lag from indexer breakage', async () => {
    fetchEnvioLogs.mockRejectedValue(new EnvioLagError(1, 9n, 8n))
    const info = vi.spyOn(console, 'info')
    const warning = vi.spyOn(console, 'warn')
    try {
      await new EvmLogsExtractor().extract(job)
      expect(info).toHaveBeenCalledWith('ENVIO_LAG_RPC', expect.objectContaining({ progress: '8' }))
      expect(warning).not.toHaveBeenCalled()
      expect(mqAdd).toHaveBeenCalledOnce()
    } finally { info.mockRestore(); warning.mockRestore() }
  })

  it('does not enqueue persistence when both Envio and RPC extraction fail', async () => {
    fetchEnvioLogs.mockRejectedValue(new Error('bad response'))
    getLogs.mockRejectedValue(new Error('RPC unavailable'))
    await expect(new EvmLogsExtractor().extract(job)).rejects.toThrow('RPC unavailable')
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('fetches full RPC coverage after an Envio failure', async () => {
    fetchEnvioLogs.mockRejectedValue(new Error('bad response'))
    await new EvmLogsExtractor().extract(job)
    expect(getLogs).toHaveBeenCalledOnce()
    expect(mqAdd).toHaveBeenCalledOnce()
  })
})
