import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContractFunctionRevertedError } from 'viem'
import { V3_ORACLE_ABI } from './abi'

const { cacheStore, cacheWrites, cacheGet, cacheSet, cacheDel, cacheKeys, next, readContract, getBlock, estimateHeightWithAge } = vi.hoisted(() => {
  const cacheStore = new Map<string, unknown>()
  const cacheWrites: { key: string, value: unknown, ttl?: number }[] = []
  const cacheGet = vi.fn(async (key: string) => cacheStore.get(key))
  const cacheSet = vi.fn(async (key: string, value: unknown, ttl?: number) => {
    cacheWrites.push({ key, value, ttl })
    cacheStore.set(key, value)
  })
  const cacheDel = vi.fn(async (key: string) => { cacheStore.delete(key) })
  const cacheKeys = vi.fn(async (pattern = '*') => {
    const prefix = pattern.replace(/\*$/, '')
    return [...cacheStore.keys()].filter(key => key.startsWith(prefix))
  })
  const readContract = vi.fn()
  const next = vi.fn(() => ({ readContract }))
  const getBlock = vi.fn(async (_chainId: number, blockNumber?: bigint) => ({
    number: blockNumber ?? 22_000_000n,
    timestamp: blockNumber === undefined ? 2_000_000_000n : 1_999_000_000n,
  }))
  const estimateHeightWithAge = vi.fn(async () => ({ height: 22_000_000n, historical: true }))
  return { cacheStore, cacheWrites, cacheGet, cacheSet, cacheDel, cacheKeys, next, readContract, getBlock, estimateHeightWithAge }
})

vi.mock('lib/cache', () => ({ cache: { get: cacheGet, set: cacheSet, del: cacheDel, keys: cacheKeys } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
vi.mock('lib/blocks', () => ({ estimateHeightWithAge, getBlock }))

import { clearNegativeAprOracleCache, readApr, resolveOracleApr } from './hook'

const VAULT = '0xAbC0000000000000000000000000000000000123' as const
const ORACLE = '0x1981AD9F44F2EA9aDd2dC4AD7D075c102C70aF92' as const
const BLOCK = 22_000_000n
const PREFIX = 'apr-oracle:negative:v1:'

function revert(functionName: string) {
  return new ContractFunctionRevertedError({ abi: V3_ORACLE_ABI, functionName })
}

function data(blockTime: bigint) {
  return { abiPath: 'yearn/3/vault', chainId: 1, address: VAULT, outputLabel: 'apr-oracle', blockTime }
}

describe('historical APR oracle negative cache', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    cacheStore.clear()
    cacheWrites.length = 0
    cacheGet.mockClear()
    cacheSet.mockClear()
    cacheDel.mockClear()
    cacheKeys.mockClear()
    next.mockClear()
    readContract.mockReset()
    getBlock.mockReset().mockImplementation(async (_chainId: number, blockNumber?: bigint) => ({
      number: blockNumber ?? BLOCK,
      timestamp: blockNumber === undefined ? 2_000_000_000n : 1_999_000_000n,
    }))
    estimateHeightWithAge.mockReset().mockResolvedValue({ height: BLOCK, historical: true })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
    vi.useRealTimers()
  })

  it('caches a confirmed historical double contract revert with a safe, case-normalized key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const now = BigInt(Math.floor(Date.now() / 1000))
    readContract.mockRejectedValueOnce(revert('getStrategyApr')).mockRejectedValueOnce(revert('getCurrentApr'))

    const historic = data(now - 2n * 86_400n)
    expect(await resolveOracleApr(1, VAULT, historic)).to.equal(undefined)
    expect(await resolveOracleApr(1, VAULT.toLowerCase() as `0x${string}`, historic)).to.equal(undefined)

    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheWrites).to.deep.equal([{
      key: `${PREFIX}1:${VAULT.toLowerCase()}:${ORACLE.toLowerCase()}:${BLOCK}`,
      value: { type: 'apr-oracle-negative', reason: 'contract-revert' },
      ttl: 30 * 24 * 60 * 60 * 1000,
    }])
  })

  it('keeps the successful getCurrentApr fallback, including a zero APR', async () => {
    readContract.mockRejectedValueOnce(revert('getStrategyApr')).mockResolvedValueOnce(0n)

    expect(await readApr(1, VAULT, BLOCK, ORACLE)).to.equal(0)
    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheWrites).to.deep.equal([])
  })

  it('propagates transport errors from the normal getCurrentApr fallback', async () => {
    readContract.mockRejectedValueOnce(revert('getStrategyApr')).mockRejectedValueOnce(new Error('fallback provider timeout'))

    await expect(readApr(1, VAULT, BLOCK, ORACLE)).rejects.toThrow('fallback provider timeout')

    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheWrites).to.deep.equal([])
  })

  it('backs off confirmed historical transport failures while preserving errors', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const now = BigInt(Math.floor(Date.now() / 1000))
    readContract.mockRejectedValue(new Error('provider timeout'))
    const historic = data(now - 2n * 86_400n)

    await expect(resolveOracleApr(1, VAULT, historic)).rejects.toThrow('provider timeout')
    expect(cacheWrites.map(write => write.ttl)).to.deep.equal([30_000, 24 * 60 * 60 * 1000])

    const key = `${PREFIX}1:${VAULT.toLowerCase()}:${ORACLE.toLowerCase()}:${BLOCK}`
    await expect(resolveOracleApr(1, VAULT, historic)).rejects.toThrow('transient backoff')
    expect(readContract).toHaveBeenCalledTimes(1)

    cacheStore.delete(key)
    await expect(resolveOracleApr(1, VAULT, historic)).rejects.toThrow('provider timeout')

    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheWrites.slice(2).map(write => write.ttl)).to.deep.equal([60_000, 24 * 60 * 60 * 1000])
  })

  it('caps repeated historical transient backoff above the normal fanout cycle', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const now = BigInt(Math.floor(Date.now() / 1000))
    readContract.mockRejectedValue(new Error('provider timeout'))
    const historic = data(now - 2n * 86_400n)
    const key = `${PREFIX}1:${VAULT.toLowerCase()}:${ORACLE.toLowerCase()}:${BLOCK}`
    cacheStore.set(`${key}:attempts`, 20)

    await expect(resolveOracleApr(1, VAULT, historic)).rejects.toThrow('provider timeout')

    expect(cacheWrites[0]?.ttl).to.equal(60 * 60 * 1000)
  })

  it('propagates current-day transport errors without caching them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    readContract.mockRejectedValue(new Error('provider timeout'))
    const currentDay = BigInt(Math.floor(Date.now() / 1000))

    await expect(resolveOracleApr(1, VAULT, data(currentDay))).rejects.toThrow('provider timeout')
    await expect(resolveOracleApr(1, VAULT, data(currentDay))).rejects.toThrow('provider timeout')

    expect(readContract).toHaveBeenCalledTimes(2)
    expect(cacheWrites).to.deep.equal([])
  })

  it('does not long-cache a revert when the observed block is still near the head', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
    const now = BigInt(Math.floor(Date.now() / 1000))
    estimateHeightWithAge.mockResolvedValue({ height: BLOCK, historical: false })
    readContract.mockRejectedValue(revert('getStrategyApr'))

    const yesterday = now - 86_400n
    await resolveOracleApr(1, VAULT, data(yesterday))
    await resolveOracleApr(1, VAULT, data(yesterday))

    expect(readContract).toHaveBeenCalledTimes(4)
    expect(cacheWrites).to.deep.equal([])
  })

  it('clears APR negative markers and their transient attempt counters for replay', async () => {
    cacheStore.set(`${PREFIX}1:${VAULT.toLowerCase()}:${ORACLE.toLowerCase()}:${BLOCK}`, { type: 'apr-oracle-negative', reason: 'contract-revert' })
    cacheStore.set(`${PREFIX}1:${VAULT.toLowerCase()}:${ORACLE.toLowerCase()}:${BLOCK}:attempts`, 3)
    cacheStore.set('unrelated:cache:key', 'keep')

    await clearNegativeAprOracleCache()

    expect(cacheDel).toHaveBeenCalledTimes(2)
    expect(cacheStore.has('unrelated:cache:key')).to.equal(true)
  })
})
