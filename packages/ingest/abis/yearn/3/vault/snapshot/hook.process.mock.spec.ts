import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, multicall, readContract } = vi.hoisted(() => ({
  query: vi.fn(),
  multicall: vi.fn(),
  readContract: vi.fn()
}))

vi.mock('../../../../../db', () => ({ default: { query }, getSparkline: vi.fn(async () => []) }))
vi.mock('../../../../../rpcs', () => ({ rpcs: { next: () => ({ multicall, readContract }) } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next: () => ({ multicall, readContract }) } }))
vi.mock('../../../../../prices', () => ({
  fetchErc20PriceUsd: vi.fn(async () => ({ priceUsd: 2, priceSource: 'test' }))
}))
vi.mock('../../../../../helpers/apy-apr', () => ({
  getLatestApy: vi.fn(async () => undefined),
  getLatestEstimatedAprV3: vi.fn(async () => undefined),
  getLatestOracleApr: vi.fn(async () => [undefined, undefined])
}))
vi.mock('../../../../../things', () => ({ exist: vi.fn(async (_c: number, _a: string, label: string) => label === 'accountant') }))
vi.mock('../../../lib/meta', () => ({
  getVaultMeta: vi.fn(async () => undefined),
  getStrategyMeta: vi.fn(async () => undefined),
  getTokenMeta: vi.fn(async () => undefined)
}))
vi.mock('../../../lib/risk', () => ({ getRiskScore: vi.fn(async () => undefined) }))

import { toEventSelector } from 'viem'
import process from './hook'

const VAULT = '0x1000000000000000000000000000000000000001' as const
const ASSET = '0x2000000000000000000000000000000000000002' as const
const ACCOUNTANT = '0x5000000000000000000000000000000000000005' as const
const ALLOCATOR = '0x3000000000000000000000000000000000000003' as const
const A = '0x0000000000000000000000000000000000000011' as const
const B = '0x0000000000000000000000000000000000000022' as const

const STRATEGY_CHANGED = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
const NEW_DEBT_ALLOCATOR = toEventSelector('event NewDebtAllocator(address indexed allocator, address indexed vault)')

function routeQueries() {
  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (params.includes(STRATEGY_CHANGED)) return { rows: [{ strategy: A, change_type: '1' }, { strategy: B, change_type: '1' }] }
    if (params.includes(NEW_DEBT_ALLOCATOR)) return { rows: [{ allocator: ALLOCATOR }] }
    if (sql.includes('erc20')) return { rows: [{ chainId: 1, address: ASSET, name: 'Asset', symbol: 'AST', decimals: 18 }] }
    return { rows: [] }
  })
}

const data = {
  asset: ASSET,
  decimals: 18,
  accountant: ACCOUNTANT,
  get_default_queue: [A, B]
}

describe('abis/yearn/3/vault/snapshot/hook process', () => {
  beforeEach(() => {
    query.mockReset()
    multicall.mockReset()
    readContract.mockReset()
    routeQueries()
    multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: 'failure' })))
  })

  it('spends one multicall and one readContract per snapshot when the accountant answers getVaultConfig', async () => {
    readContract.mockResolvedValue([100, 1000])

    await process(1, VAULT, data)

    expect(multicall).toHaveBeenCalledTimes(1)
    expect(multicall.mock.calls[0][0].contracts).toHaveLength(8)
    expect(readContract).toHaveBeenCalledTimes(1)
  })

  it('stays within one multicall and three readContract when every accountant fee read falls back', async () => {
    readContract
      .mockRejectedValueOnce(new Error('getVaultConfig'))
      .mockRejectedValueOnce(new Error('defaultConfig'))
      .mockResolvedValueOnce([100, 1000, 0])

    await process(1, VAULT, data)

    expect(multicall).toHaveBeenCalledTimes(1)
    expect(readContract).toHaveBeenCalledTimes(3)
  })
})
