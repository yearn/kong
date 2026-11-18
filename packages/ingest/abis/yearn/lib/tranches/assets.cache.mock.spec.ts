import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheStore, cacheTtls, cacheWrap, next, multicall, readContract, latestBlocks } = vi.hoisted(() => {
  const cacheStore = new Map<string, unknown>()
  const cacheTtls: { key: string, ttl: unknown }[] = []
  const latestBlocks: Record<number, { blockNumber: bigint, blockTime: bigint, observedAt: number }> = {}
  const multicall = vi.fn()
  const readContract = vi.fn()
  const next = vi.fn(() => ({ multicall, readContract }))
  const cacheWrap = vi.fn(async (key: string, fn: () => Promise<string>, ttl?: unknown) => {
    cacheTtls.push({ key, ttl })
    if (!cacheStore.has(key)) cacheStore.set(key, await fn())
    return cacheStore.get(key)
  })
  return { cacheStore, cacheTtls, cacheWrap, next, multicall, readContract, latestBlocks }
})

vi.mock('lib/cache', () => ({ cache: { wrap: cacheWrap } }))
vi.mock('../../../../rpcs', () => ({ rpcs: { next }, latestBlocks }))

import { ThingSchema } from 'lib/types'
import { addresses } from '../../../../test-addresses'
import { readPps } from './assets'

const BLOCK = 25_600_000n

function tranche(decimals = 6) {
  return ThingSchema.parse({
    chainId: 1,
    address: addresses.tranche.a,
    label: 'vault',
    defaults: {
      decimals,
      asset: addresses.tranche.usdc,
      apiVersion: '3.1.0',
      trancheController: addresses.tranche.controller
    }
  })
}

describe('Yearn PPS observation cache', () => {
  beforeEach(() => {
    cacheStore.clear()
    cacheTtls.length = 0
    cacheWrap.mockClear()
    next.mockClear()
    multicall.mockReset().mockResolvedValue([1000448417n, 999999744n])
    readContract.mockReset().mockResolvedValue(2n ** 255n + 333n)
    for (const chainId of Object.keys(latestBlocks)) delete latestBlocks[Number(chainId)]
  })

  afterEach(() => vi.restoreAllMocks())

  it('reuses the controller-backed tranche PPS and preserves its share scale', async () => {
    const expected = 1000448417n * 10n ** 6n / 999999744n
    const first = await readPps(tranche(), BLOCK)
    const second = await readPps(tranche(), BLOCK)

    expect(first).to.equal(expected)
    expect(second).to.equal(expected)
    expect(multicall).toHaveBeenCalledTimes(1)
    expect(readContract).not.toHaveBeenCalled()

    const [request] = multicall.mock.calls[0]
    expect(request.contracts.map((contract: { functionName: string }) => contract.functionName))
      .to.deep.equal(['liveAssets', 'totalSupply'])
    expect(request.contracts[0].address).to.equal(addresses.tranche.controller)
    expect(request.contracts[0].args).to.deep.equal([addresses.tranche.a])
    expect(cacheTtls[0].key).to.contain(`yearn:tranche:${addresses.tranche.controller.toLowerCase()}:scale:1000000`)
  })

  it('keeps vanilla pricePerShare as a raw bigint cache entry', async () => {
    const vault = ThingSchema.parse({
      chainId: 1, address: addresses.tranche.mainVault, label: 'vault',
      defaults: { apiVersion: '3.1.0', decimals: 6 }
    })
    const expected = 2n ** 255n + 333n

    expect(await readPps(vault, BLOCK)).to.equal(expected)
    expect(await readPps(vault, BLOCK)).to.equal(expected)
    expect(readContract).toHaveBeenCalledTimes(1)
    expect(cacheTtls[0].key).to.contain('yearn:pricePerShare')
  })

  it('does not cache a failed PPS read', async () => {
    const vault = ThingSchema.parse({
      chainId: 1, address: addresses.tranche.mainVault, label: 'vault',
      defaults: { apiVersion: '3.1.0', decimals: 6 }
    })
    readContract.mockRejectedValueOnce(new Error('temporary failure'))

    await expect(readPps(vault, BLOCK)).rejects.toThrow('temporary failure')
    expect(await readPps(vault, BLOCK)).to.equal(2n ** 255n + 333n)
    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheStore.size).to.equal(1)
  })
})
