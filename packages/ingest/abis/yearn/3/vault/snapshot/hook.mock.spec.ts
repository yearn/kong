import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, multicall } = vi.hoisted(() => ({ query: vi.fn(), multicall: vi.fn() }))

vi.mock('../../../../../db', () => ({ default: { query }, getSparkline: vi.fn() }))
vi.mock('../../../../../rpcs', () => ({ rpcs: { next: () => ({ multicall }) } }))
vi.mock('../../../../../prices', () => ({
  fetchErc20PriceUsd: vi.fn(async () => ({ priceUsd: 2, priceSource: 'test' }))
}))

import { extractDebts, projectStrategies } from './hook'
import { toEventSelector } from 'viem'

const VAULT = '0x1000000000000000000000000000000000000001' as const
const ASSET = '0x2000000000000000000000000000000000000002' as const
const A = '0x00000000000000000000000000000000000000a1' as const
const B = '0x00000000000000000000000000000000000000b2' as const
const C = '0x00000000000000000000000000000000000000c3' as const
const ALLOCATOR = '0x3000000000000000000000000000000000000003' as const

describe('abis/yearn/3/vault/snapshot/hook', () => {
  beforeEach(() => {
    query.mockReset()
    multicall.mockReset()
  })

  it('extractDebts issues one multicall for N strategies', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: [1n, 2n, 3n, 4n] },
      { status: 'success', result: 100 },
      { status: 'success', result: 5000n },
      { status: 'success', result: 10000n },
      { status: 'success', result: [5n, 6n, 7n, 8n] },
      { status: 'success', result: 200 },
      { status: 'failure' },
      { status: 'failure' },
      { status: 'failure' },
      { status: 'failure' },
      { status: 'failure' },
      { status: 'failure' }
    ])

    const debts = await extractDebts(1, VAULT, [A, B, C], ALLOCATOR, { asset: ASSET, decimals: 18 })

    expect(multicall).toHaveBeenCalledTimes(1)
    expect(multicall.mock.calls[0][0].contracts).toHaveLength(12)
    expect(query).not.toHaveBeenCalled()
    expect(debts.map(d => d.strategy)).toEqual([A, B, C])
    expect(debts[0]).toMatchObject({ currentDebt: 3n, maxDebt: 4n, performanceFee: 100n, targetDebtRatio: 5000, maxDebtRatio: 10000 })
    expect(debts[1]).toMatchObject({ currentDebt: 7n, performanceFee: 200n, targetDebtRatio: undefined })
    expect(debts[2]).toMatchObject({ currentDebt: 0n, performanceFee: 0n })
  })

  it('extractDebts without allocator uses two calls per strategy', async () => {
    multicall.mockResolvedValue([{ status: 'failure' }, { status: 'failure' }, { status: 'failure' }, { status: 'failure' }])
    await extractDebts(1, VAULT, [A, B], undefined, { asset: ASSET, decimals: 18 })
    expect(multicall).toHaveBeenCalledTimes(1)
    expect(multicall.mock.calls[0][0].contracts).toHaveLength(4)
  })

  it('preserves zero ratios and debts for a zero-decimal asset', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: [1n, 2n, 3n, 4n] },
      { status: 'success', result: 0 },
      { status: 'success', result: 0n },
      { status: 'success', result: 0n }
    ])
    const debts = await extractDebts(1, VAULT, [A], ALLOCATOR, { asset: ASSET, decimals: 0 })
    expect(debts).toHaveLength(1)
    expect(debts[0]).toMatchObject({ currentDebtUsd: 6, targetDebtRatio: 0, maxDebtRatio: 0 })
    expect(query).not.toHaveBeenCalled()
  })

  it('extractDebts without allocator reads no ratios and keeps each strategy own debt', async () => {
    multicall.mockResolvedValue([
      { status: 'success', result: [1n, 2n, 3n, 4n] },
      { status: 'success', result: 100 },
      { status: 'success', result: [5n, 6n, 7n, 8n] },
      { status: 'success', result: 200 }
    ])
    const debts = await extractDebts(1, VAULT, [A, B], undefined, { asset: ASSET, decimals: 18 })

    expect(debts.map(d => d.currentDebt)).toEqual([3n, 7n])
    expect(debts.map(d => d.performanceFee)).toEqual([100n, 200n])
    for (const debt of debts) {
      expect(debt.targetDebtRatio).toBeUndefined()
      expect(debt.maxDebtRatio).toBeUndefined()
    }
  })

  it('extractDebts falls back to the stored snapshot only when asset or decimals is missing', async () => {
    multicall.mockResolvedValue([{ status: 'failure' }, { status: 'failure' }])
    query.mockResolvedValue({ rows: [{ asset: ASSET, decimals: 6 }] })

    await extractDebts(1, VAULT, [A], undefined, {})
    expect(query).toHaveBeenCalledTimes(1)
    expect(multicall).toHaveBeenCalledTimes(1)

    query.mockClear()
    await extractDebts(1, VAULT, [A], undefined, { asset: ASSET, decimals: 6 })
    expect(query).not.toHaveBeenCalled()
  })

  it('projectStrategies ignores revoke of an unknown strategy', async () => {
    query.mockResolvedValue({ rows: [
      { strategy: A, change_type: '1' },
      { strategy: B, change_type: '1' },
      { strategy: C, change_type: '2' }
    ] })
    expect(await projectStrategies(1, VAULT)).toEqual([A, B])
    expect(toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')).toBe(query.mock.calls[0][1][2])
  })
})
