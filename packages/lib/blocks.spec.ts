import { expect } from 'chai'
import { afterEach, describe, it, vi } from 'vitest'
import { cache } from './cache'
import { createClient } from 'redis'
import { __estimateHeight, estimateCreationBlock, getBlock, getDefaultStartBlockNumber } from './blocks'
import { rpcs } from './rpcs'

describe('blocks', function() {
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

  it.each(['clean', 'empty', 'throw'] as const)('stores the actual Redis TTL after a %s creation search', async mode => {
    const originalNext = rpcs.next
    const chainId = { clean: 31341, empty: 31342, throw: 31343 }[mode]
    const address = '0x0000000000000000000000000000000000000009'
    const key = `estimateCreationBlock:${chainId}:${address}`
    const redis = createClient({ socket: { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) } })
    await redis.connect()
    await cache.del(key)
    await cache.del(`getBlock:${chainId}:undefined`)
    await cache.del(`getBlock:${chainId}:2`)
    rpcs.next = (() => ({
      getBlockNumber: async () => 2n,
      getBytecode: async () => {
        if (mode === 'throw') throw new Error('pruned')
        return mode === 'clean' ? '0x6000' : '0x'
      },
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({ number: blockNumber ?? 2n, timestamp: 1n })
    })) as unknown as typeof rpcs.next
    try {
      await estimateCreationBlock(chainId, address)
      const ttl = await redis.pTTL(key)
      const expected = mode === 'clean' ? 30 * 24 * 60 * 60 * 1000 : 10_000
      expect(ttl).to.be.within(expected - 5_000, expected)
    } finally {
      rpcs.next = originalNext
      await cache.del(key)
      await cache.del(`getBlock:${chainId}:undefined`)
      await cache.del(`getBlock:${chainId}:1`)
      await cache.del(`getBlock:${chainId}:2`)
      await redis.quit()
    }
  })

  describe('cache ttl', function() {
    afterEach(() => vi.restoreAllMocks())

    function stubWrap(impl: unknown) {
      vi.spyOn(cache as never, 'wrap' as never, 'get' as never).mockReturnValue(impl as never)
    }

    function spyOnWrap(value: unknown) {
      const wrap = vi.fn(async () => value)
      stubWrap(wrap)
      return wrap
    }

    it('caches the creation block for 30 days', async function() {
      const wrap = spyOnWrap({ chainId: 1, number: 1n, timestamp: 2n })
      await estimateCreationBlock(1, '0x0000000000000000000000000000000000000001')
      const ttl = (wrap.mock.calls[0] as unknown[])[2] as () => number
      expect(ttl()).to.equal(30 * 24 * 60 * 60 * 1000)
    })

    it('keeps the 10s ttl when the creation block search hit an rpc error', async function() {
      const originalNext = rpcs.next
      let ttl: (() => number) | undefined
      stubWrap(async (key: string, fn: () => Promise<unknown>, t: () => number) => {
        if (key.startsWith('estimateCreationBlock')) ttl = t
        return await fn()
      })
      await cache.del('getBlock:31339:undefined')
      await cache.del('getBlock:31339:1')
      rpcs.next = (() => ({
        getBlockNumber: async () => 2n,
        getBytecode: async () => { throw new Error('flaky') },
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({ number: blockNumber ?? 2n, timestamp: 1n })
      })) as unknown as typeof rpcs.next

      try {
        await estimateCreationBlock(31339, '0x0000000000000000000000000000000000000002')
        expect(ttl!()).to.equal(10_000)
      } finally {
        rpcs.next = originalNext
        await cache.del('getBlock:31339:undefined')
        await cache.del('getBlock:31339:1')
      }
    })

    it('caches the default start block for 1 hour', async function() {
      const wrap = spyOnWrap(1n)
      await getDefaultStartBlockNumber(1)
      expect((wrap.mock.calls[0] as unknown[])[2]).to.equal(60 * 60 * 1000)
    })
  })
})
