import { expect } from 'chai'
import { cache } from './cache'
import { __estimateHeight, estimateHeight, getBlock } from './blocks'
import { rpcs } from './rpcs'

describe('blocks', function() {
  it('keeps historical estimates for a day but refreshes head clamps', async function() {
    const originalNext = rpcs.next
    const ownWrapDescriptor = Object.getOwnPropertyDescriptor(cache, 'wrap')
    const records = new Map<string, { value: unknown, expiresAt: number }>()
    const calls = new Map<string, number>()
    const ttls = new Map<string, number>()
    let now = 0
    const wrap = async <T>(key: string, fn: () => Promise<T>, ttl?: number | ((value: T) => number)): Promise<T> => {
      const cached = records.get(key)
      if (cached && (cached.expiresAt === 0 || cached.expiresAt > now)) return cached.value as T
      calls.set(key, (calls.get(key) ?? 0) + 1)
      const value = await fn()
      const duration = typeof ttl === 'function' ? ttl(value) : ttl ?? 0
      ttls.set(key, duration)
      records.set(key, { value, expiresAt: duration === 0 ? 0 : now + duration })
      return value
    }

    const historicalChain = 31340
    const clampChain = 31341
    const gapChain = 31342
    let clampHeadNumber = 100n
    rpcs.next = ((chainId: number) => ({
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
        if (chainId === historicalChain) {
          const number = blockNumber ?? 100n
          return { number, timestamp: number === 100n ? 200_000n : number * 2_000n }
        }
        if (chainId === gapChain) {
          const number = blockNumber ?? 10n
          return { number, timestamp: number === 10n ? 200_010n : number === 1n ? 1n : 200_000n + number }
        }
        const number = blockNumber ?? clampHeadNumber
        return { number, timestamp: number }
      }
    })) as unknown as typeof rpcs.next
    Object.defineProperty(cache, 'wrap', { configurable: true, value: wrap })

    try {
      const historicalKey = `estimateHeight:v2:${historicalChain}:100000`
      expect(await estimateHeight(historicalChain, 100_000n)).to.equal(50n)
      now = 11_000
      expect(await estimateHeight(historicalChain, 100_000n)).to.equal(50n)
      expect(calls.get(historicalKey)).to.equal(1)
      expect(ttls.get(historicalKey)).to.equal(24 * 60 * 60 * 1000)

      // An old target can resolve to a recent block when timestamps have a
      // large gap. Cache that result briefly because the resolved block is
      // still close to the observed head.
      const gapKey = `estimateHeight:v2:${gapChain}:100000`
      expect(await estimateHeight(gapChain, 100_000n)).to.equal(2n)
      expect(calls.get(gapKey)).to.equal(1)
      expect(ttls.get(gapKey)).to.equal(10_000)

      // The chain head is stale in wall-clock time (timestamp 100), so this
      // request must remain a short-lived head clamp even though it is old to
      // the process clock. This checks the estimate TTL, not head advancement.
      const stalledChainTimestamp = 101n
      const clampKey = `estimateHeight:v2:${clampChain}:${stalledChainTimestamp}`
      expect(await estimateHeight(clampChain, stalledChainTimestamp)).to.equal(100n)
      now += 10_001
      clampHeadNumber = 200n
      // getBlock's own head cache is intentionally 15 minutes. Invalidate it
      // here to model a newly observed head before checking the short estimate
      // TTL; this is separate from the estimate cache under test.
      records.delete(`getBlock:${clampChain}:undefined`)
      expect(await estimateHeight(clampChain, stalledChainTimestamp)).to.equal(101n)
      expect(calls.get(clampKey)).to.equal(2)
      expect(ttls.get(clampKey)).to.equal(10_000)
    } finally {
      rpcs.next = originalNext
      if (ownWrapDescriptor) Object.defineProperty(cache, 'wrap', ownWrapDescriptor)
      else delete (cache as unknown as Record<string, unknown>).wrap
    }
  })

  it.skipIf(!process.env.HTTP_ARCHIVE_1)('estimates block height', async function() {
    const result = await __estimateHeight(1, 1716356553n)
    const ranged = result >= 19923410n && result <= 19923414n
    if (!ranged) console.error ('result', result)
    expect (ranged).to.be.true
  }, 5_000)

  it('fetches block zero as a historical block', async function() {
    const originalNext = rpcs.next
    const calls: { archive: boolean, blockNumber?: bigint }[] = []
    await cache.del('getBlock:31337:undefined')
    await cache.del('getBlock:31337:0')

    rpcs.next = ((chainId: number, archive = true) => {
      expect(chainId).to.equal(31337)
      return {
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
          calls.push({ archive, blockNumber })
          return blockNumber === 0n
            ? { number: 0n, timestamp: 123n }
            : { number: 1_000n, timestamp: 999n }
        }
      }
    }) as unknown as typeof rpcs.next

    try {
      const block = await getBlock(31337, 0n)
      expect(block.number).to.equal(0n)
      expect(block.timestamp).to.equal(123n)
      expect(calls.map(call => call.blockNumber)).to.deep.equal([undefined, 0n])
      // block 0 is the deepest block on the chain, so it must route to an
      // archive node — guards against the falsy-bigint regression where `!0n`
      // sent it to a full node.
      const blockZeroCall = calls.find(call => call.blockNumber === 0n)
      expect(blockZeroCall?.archive, 'block 0 must use an archive node').to.be.true
    } finally {
      rpcs.next = originalNext
      await cache.del('getBlock:31337:undefined')
      await cache.del('getBlock:31337:0')
    }
  })

  it('returns first block at or after timestamp when adjacent timestamps repeat', async function() {
    const originalNext = rpcs.next
    const blocks = new Map<bigint, bigint>([
      [1n, 0n],
      [2n, 90n],
      [3n, 90n],
      [4n, 100n],
      [5n, 1_000n]
    ])
    const chainId = 31338

    await Promise.all(
      ['undefined', '1', '2', '3', '4', '5'].map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`))
    )

    rpcs.next = ((chain: number) => {
      expect(chain).to.equal(chainId)
      return {
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
          const number = blockNumber ?? 5n
          return { number, timestamp: blocks.get(number) ?? 0n }
        }
      }
    }) as unknown as typeof rpcs.next

    try {
      expect(await __estimateHeight(chainId, 90n)).to.equal(2n)
      expect(await __estimateHeight(chainId, 95n)).to.equal(4n)
    } finally {
      rpcs.next = originalNext
      await Promise.all(
        ['undefined', '1', '2', '3', '4', '5'].map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`))
      )
    }
  })

  it('falls back to binary search when the first block is not served', async function() {
    const originalNext = rpcs.next
    const chainId = 31339
    const keys = ['undefined', ...Array.from({ length: 101 }, (_, i) => String(i))]
    await Promise.all(keys.map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`)))

    rpcs.next = (() => ({
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
        if (blockNumber === 1n) throw new Error('Block at number "1" could not be found.')
        const number = blockNumber ?? 100n
        return { number, timestamp: number * 10n }
      }
    })) as unknown as typeof rpcs.next

    try {
      expect(await __estimateHeight(chainId, 425n)).to.equal(43n)
    } finally {
      rpcs.next = originalNext
      await Promise.all(keys.map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`)))
    }
  })
})
