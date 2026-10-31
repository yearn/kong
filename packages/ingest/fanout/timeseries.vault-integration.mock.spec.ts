import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import type { AbiHook, HookType } from '../abis/types'

type MulticallContract = { functionName: string }
type MulticallRequest = { contracts: MulticallContract[] }
type CapturedQueueCall = { job: unknown, data: unknown, options?: unknown }

const {
  dbQuery, dbFirst, dbSome, vaultFixture, rpcMulticall, rpcNext,
  fetchPrice, queueCalls, mqAdd
} = vi.hoisted(() => {
  process.env.TVL_GROUPED_JOBS = 'true'

  const vaultFixture: { value: unknown } = { value: undefined }
  const queueCalls: CapturedQueueCall[] = []
  const dbQuery = vi.fn<(sql: string, params: unknown[]) => Promise<{ rows: { day: string }[] }>>(async () => ({ rows: [] }))
  const dbFirst = vi.fn(async () => vaultFixture.value)
  const dbSome = vi.fn(async () => false)
  const rpcMulticall = vi.fn(async ({ contracts }: MulticallRequest) => contracts.map(contract => {
    if (contract.functionName === 'totalAssets') return { status: 'success' as const, result: 5_000_000_000_000_000_000n }
    if (contract.functionName === 'withdrawalQueue') return { status: 'success' as const, result: '0x0000000000000000000000000000000000000000' }
    return { status: 'failure' as const, error: new Error(`unexpected mock call: ${contract.functionName}`) }
  }))
  const rpcClient = { multicall: rpcMulticall, readContract: vi.fn(async () => 0n) }
  const rpcNext = vi.fn(() => rpcClient)
  const fetchPrice = vi.fn(async () => ({ priceUsd: 2, priceSource: 'priceservice' }))
  const mqAdd = vi.fn(async (job: unknown, data: unknown, options?: unknown) => {
    queueCalls.push({ job, data, options })
  })

  return { dbQuery, dbFirst, dbSome, vaultFixture, rpcMulticall, rpcNext, fetchPrice, queueCalls, mqAdd }
})

vi.mock('../db', () => ({
  default: { query: dbQuery },
  first: dbFirst,
  some: dbSome
}))

vi.mock('../rpcs', () => ({ rpcs: { next: rpcNext } }))

vi.mock('../prices', () => ({ fetchErc20PriceUsd: fetchPrice }))

vi.mock('lib/blocks', () => ({
  getBlockNumber: vi.fn(async () => 3n),
  getBlockTime: vi.fn(async () => 1704153599n),
  getDefaultStartBlockNumber: vi.fn(async () => 0n),
  estimateHeight: vi.fn(async () => 100n),
  getBlock: vi.fn(async () => ({ number: 100n, timestamp: 1704153599n }))
}))

vi.mock('lib/mq', () => ({
  job: {
    extract: { timeseries: { queue: 'extract', name: 'timeseries', bychain: true } },
    load: { output: { queue: 'load', name: 'output' } }
  },
  add: mqAdd
}))

import { requireHooks } from '../abis'
import { TimeseriesExtractor } from '../extract/timeseries'
import TimeseriesFanout from './timeseries'

const CHAIN_ID = 1
const ADDRESS = '0x1111111111111111111111111111111111111111' as const
const ASSET = '0x2222222222222222222222222222222222222222' as const

const vaultVariants = [
  { abiPath: 'yearn/2/vault', defaults: { apiVersion: '0.4.5', asset: ASSET, decimals: 18 } },
  { abiPath: 'yearn/3/vault', defaults: { apiVersion: '3.0.0', asset: ASSET, decimals: 18 } },
  { abiPath: 'erc4626', defaults: { asset: ASSET, decimals: 18 } }
] as const

describe.each(vaultVariants)('real $abiPath TVL hooks through fanout and extract', ({ abiPath, defaults }) => {
  beforeEach(() => {
    vaultFixture.value = { chainId: CHAIN_ID, address: ADDRESS, label: 'vault', defaults }
    dbQuery.mockClear()
    dbFirst.mockClear()
    dbSome.mockClear()
    rpcMulticall.mockClear()
    rpcNext.mockClear()
    fetchPrice.mockClear()
    queueCalls.length = 0
  })

  it('passes the real grouped job through the real extractor and computes one observation', async () => {
    const abiDirectory = path.resolve(__dirname, `../abis/${abiPath}`)
    const realResolver = await requireHooks(abiDirectory)
    const resolveTvlHooks = (path: string, type?: HookType): AbiHook[] => realResolver(path, type)
      .filter(hook => hook.module.outputLabel === 'tvl' || hook.module.outputLabel === 'tvl-c')

    const hooks = resolveTvlHooks(abiPath, 'timeseries')
    expect(hooks.map(hook => hook.module.outputLabel).sort()).to.deep.equal(['tvl', 'tvl-c'])
    expect(hooks[0].module.outputGroup).to.not.equal(undefined)
    expect(hooks[1].module.outputGroup?.process).to.equal(hooks[0].module.outputGroup?.process)

    const fanout = new TimeseriesFanout()
    fanout.resolveHooks = resolveTvlHooks
    await fanout.fanout({
      abi: { abiPath, sources: [], skip: false, only: false },
      source: {
        chainId: CHAIN_ID,
        address: ADDRESS,
        inceptBlock: 1n,
        skip: false,
        only: false,
        startBlock: 1n,
        endBlock: 1n
      }
    })

    const extractJobs = queueCalls.filter(call => (call.job as { queue?: string } | undefined)?.queue === 'extract')
    expect(extractJobs).to.have.length(1)
    const jobData = extractJobs[0].data as {
      abiPath: string
      chainId: number
      address: `0x${string}`
      outputLabel: string
      outputLabels: string[]
      blockTime: bigint
    }
    expect(jobData.outputLabels).to.deep.equal(['tvl', 'tvl-c'])

    const extractor = new TimeseriesExtractor()
    extractor.resolveHooks = resolveTvlHooks
    await extractor.extract(jobData)

    const loadJobs = queueCalls.filter(call => (call.job as { queue?: string } | undefined)?.queue === 'load')
    expect(loadJobs).to.have.length(1)
    const rows = (loadJobs[0].data as { batch: { label: string, component?: string, value?: number | null }[] }).batch
    expect(rows).to.have.length(6)
    expect(rows.filter(row => row.label === 'tvl')).to.have.length(1)
    expect(rows.filter(row => row.label === 'tvl-c')).to.have.length(5)
    expect(rows.find(row => row.label === 'tvl' && row.component === 'tvl')?.value).to.equal(10)
    expect(rows.filter(row => row.label === 'tvl-c').map(row => row.component).sort()).to.deep.equal([
      'delegated', 'delegatedAssets', 'priceUsd', 'totalAssets', 'tvl'
    ])
    expect(rows.find(row => row.label === 'tvl-c' && row.component === 'totalAssets')?.value).to.equal(5)

    expect(fetchPrice).toHaveBeenCalledTimes(1)
    const authoritativeAssetReads = rpcMulticall.mock.calls.flatMap(([request]) => request.contracts)
      .filter(contract => contract.functionName === 'totalAssets')
    expect(authoritativeAssetReads).to.have.length(1)
  })
})
