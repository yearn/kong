import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheStore, cacheTtls, cacheWrap, next, readContract, latestBlocks } = vi.hoisted(() => {
  const cacheStore = new Map<string, unknown>()
  const cacheTtls: { key: string, ttl: unknown }[] = []
  const latestBlocks: Record<number, { blockNumber: bigint, blockTime: bigint, observedAt: number }> = {}
  const readContract = vi.fn()
  const next = vi.fn(() => ({ readContract }))
  const cacheWrap = vi.fn(async (key: string, fn: () => Promise<string>, ttl?: unknown) => {
    cacheTtls.push({ key, ttl })
    if (!cacheStore.has(key)) cacheStore.set(key, await fn())
    return cacheStore.get(key)
  })

  return { cacheStore, cacheTtls, cacheWrap, next, readContract, latestBlocks }
})

vi.mock('lib/cache', () => ({ cache: { wrap: cacheWrap } }))
vi.mock('../../rpcs', () => ({ rpcs: { next }, latestBlocks }))

import { ppsReadParameters, readPpsAtBlock, readPpsWithParameters } from './lib'

const VAULT = '0xAbC0000000000000000000000000000000000123' as const
const LOWER_VAULT = VAULT.toLowerCase() as `0x${string}`

describe('erc4626 share-decimal cache', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    cacheStore.clear()
    cacheTtls.length = 0
    cacheWrap.mockClear()
    next.mockClear()
    readContract.mockReset().mockResolvedValue(18n)
    for (const chainId of Object.keys(latestBlocks)) delete latestBlocks[Number(chainId)]
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => warn.mockRestore())

  it('reuses successful decimals for PPS and APY parameter requests', async () => {
    const pps = await ppsReadParameters(1, VAULT, 6)
    const apy = await ppsReadParameters(1, LOWER_VAULT, 6)

    expect(readContract).toHaveBeenCalledTimes(1)
    expect(pps.args).to.deep.equal([10n ** 18n])
    expect(apy.args).to.deep.equal([10n ** 18n])
    expect(cacheTtls).to.deep.equal([{
      key: `erc4626:shareDecimals:1:${LOWER_VAULT}`,
      ttl: 24 * 60 * 60 * 1000
    }, {
      key: `erc4626:shareDecimals:1:${LOWER_VAULT}`,
      ttl: 24 * 60 * 60 * 1000
    }])
  })

  it('keeps cache entries separate by chain', async () => {
    readContract.mockImplementation(async () => 1n + BigInt(readContract.mock.calls.length))

    const first = await ppsReadParameters(1, VAULT, 6)
    const second = await ppsReadParameters(137, VAULT, 6)

    expect(readContract).toHaveBeenCalledTimes(2)
    expect(first.args).to.deep.equal([10n ** 2n])
    expect(second.args).to.deep.equal([10n ** 3n])
    expect(cacheStore.has(`erc4626:shareDecimals:1:${LOWER_VAULT}`)).to.equal(true)
    expect(cacheStore.has(`erc4626:shareDecimals:137:${LOWER_VAULT}`)).to.equal(true)
  })

  it('preserves zero share decimals as a cached value', async () => {
    readContract.mockResolvedValue(0n)

    const first = await ppsReadParameters(1, VAULT, 18)
    const second = await ppsReadParameters(1, LOWER_VAULT, 18)

    expect(readContract).toHaveBeenCalledTimes(1)
    expect(first.args).to.deep.equal([1n])
    expect(second.args).to.deep.equal([1n])
    expect(cacheStore.get(`erc4626:shareDecimals:1:${LOWER_VAULT}`)).to.equal('0')
  })

  it('does not cache a failed read, allowing recovery', async () => {
    readContract
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(18n)

    const fallback = await ppsReadParameters(1, VAULT, 6)
    const recovered = await ppsReadParameters(1, VAULT, 6)

    expect(fallback.args).to.deep.equal([10n ** 6n])
    expect(recovered.args).to.deep.equal([10n ** 18n])
    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheStore.has(`erc4626:shareDecimals:1:${LOWER_VAULT}`)).to.equal(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('shares exact PPS quotes by chain, vault, block and actual share scale', async () => {
    const expected = 2n ** 255n + 9_876_543n
    readContract.mockReset().mockResolvedValueOnce(18n).mockResolvedValueOnce(expected)

    const first = await readPpsAtBlock(1, VAULT, 123n, 6, { blockTime: BigInt(Math.floor(Date.now() / 1000)) })
    const second = await readPpsAtBlock(1, LOWER_VAULT, 123n, 6)

    expect(first).to.equal(expected)
    expect(second).to.equal(expected)
    expect(readContract).toHaveBeenCalledTimes(2) // one decimals read and one convertToAssets read
    expect(cacheStore.has(`pps:v1:1:${LOWER_VAULT}:123:erc4626:convertToAssets:${10n ** 18n}`)).to.equal(true)
  })

  it('reuses one resolved share scale across the APY observations', async () => {
    const parameters = await ppsReadParameters(1, VAULT, 6)
    const points = await Promise.all([100n, 200n, 300n, 400n].map((blockNumber, index) =>
      readPpsWithParameters(1, VAULT, blockNumber, parameters, { isHistorical: index > 0 })
    ))

    expect(points).to.deep.equal([18n, 18n, 18n, 18n])
    expect(readContract).toHaveBeenCalledTimes(5) // one decimals read plus four observation quotes
    expect(cacheTtls.filter(({ key }) => key.startsWith('erc4626:shareDecimals:')).length).to.equal(1)
  })
})
