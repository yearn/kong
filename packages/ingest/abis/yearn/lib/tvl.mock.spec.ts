import { beforeEach, describe, expect, it, vi } from 'vitest'

const { multicall, fetchPrice } = vi.hoisted(() => ({ multicall: vi.fn(), fetchPrice: vi.fn() }))

vi.mock('../../../rpcs', () => ({ rpcs: { next: () => ({ multicall }) } }))
vi.mock('../../../prices', () => ({ fetchErc20PriceUsd: fetchPrice }))
vi.mock('../../../db', () => ({ default: {}, first: vi.fn(), some: vi.fn() }))
vi.mock('lib/blocks', () => ({ estimateHeight: vi.fn(), getBlock: vi.fn() }))
vi.mock('../2/vault/snapshot/hook', () => ({ extractWithdrawalQueue: vi.fn(async () => []) }))

import { _compute } from './tvl'
import { ThingSchema } from 'lib/types'

const vault = ThingSchema.parse({
  chainId: 1,
  address: '0x1000000000000000000000000000000000000001',
  label: 'vault',
  defaults: { apiVersion: '3.0.0', asset: '0x2000000000000000000000000000000000000002', decimals: 18 }
})

describe('abis/yearn/lib/tvl memo', () => {
  beforeEach(() => {
    multicall.mockReset()
    fetchPrice.mockReset()
    multicall.mockResolvedValue([{ status: 'success', result: 5n * 10n ** 18n }, { status: 'failure' }])
    fetchPrice.mockResolvedValue({ priceUsd: 2, priceSource: 'test' })
  })

  it('computes once per (chain, address, block) and keeps bigint totalAssets', async () => {
    const first = await _compute(vault, 100n)
    const second = await _compute(vault, 100n)

    expect(multicall).toHaveBeenCalledTimes(1)
    expect(typeof second.totalAssets).toBe('bigint')
    expect(second.totalAssets).toBe(5n * 10n ** 18n)
    expect(second).toBe(first)
    expect(second.tvl).toBe(10)
  })

  it('misses on another block', async () => {
    await _compute(vault, 101n)
    await _compute(vault, 102n)
    expect(multicall).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent tvl and tvl-c computations', async () => {
    const [legacy, components] = await Promise.all([_compute(vault, 104n), _compute(vault, 104n)])
    expect(components).toEqual(legacy)
    expect(multicall).toHaveBeenCalledTimes(1)
    expect(fetchPrice).toHaveBeenCalledTimes(1)
  })

  it('recomputes when corrected defaults change the asset scale', async () => {
    await _compute(vault, 105n)
    const corrected = await _compute({ ...vault, defaults: { ...vault.defaults, decimals: 17 } }, 105n)
    expect(corrected.tvl).toBe(100)
    expect(multicall).toHaveBeenCalledTimes(2)
  })

  it('retries after a rejected shared computation', async () => {
    fetchPrice.mockRejectedValueOnce(new Error('price failed'))
    await expect(_compute(vault, 106n)).rejects.toThrow('price failed')
    expect((await _compute(vault, 106n)).tvl).toBe(10)
  })

  it('does not memoize unavailable prices', async () => {
    fetchPrice.mockResolvedValue({ priceUsd: 0, priceSource: 'unavailable' })
    await _compute(vault, 103n)
    await _compute(vault, 103n)
    expect(multicall).toHaveBeenCalledTimes(2)
  })
})
