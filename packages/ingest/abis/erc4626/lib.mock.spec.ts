import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { cacheStore, cacheTtls, cacheWrap, next, readContract } = vi.hoisted(() => {
  const cacheStore = new Map<string, unknown>()
  const cacheTtls: { key: string, ttl: unknown }[] = []
  const readContract = vi.fn()
  const next = vi.fn(() => ({ readContract }))
  const cacheWrap = vi.fn(async (key: string, fn: () => Promise<string>, ttl?: unknown) => {
    cacheTtls.push({ key, ttl })
    if (!cacheStore.has(key)) cacheStore.set(key, await fn())
    return cacheStore.get(key)
  })

  return { cacheStore, cacheTtls, cacheWrap, next, readContract }
})

vi.mock('lib/cache', () => ({ cache: { wrap: cacheWrap } }))
vi.mock('../../rpcs', () => ({ rpcs: { next } }))

import { ppsReadParameters } from './lib'

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
})
