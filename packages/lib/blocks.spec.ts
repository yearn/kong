import { expect } from 'chai'
import { cache } from './cache'
import { __estimateHeight, getBlock } from './blocks'
import { rpcs } from './rpcs'

describe('blocks', function() {
  it('estimates block height', async function() {
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
      [0n, 0n],
      [1n, 0n],
      [2n, 90n],
      [3n, 90n],
      [4n, 100n],
      [5n, 1_000n]
    ])
    const chainId = 31338

    await Promise.all(
      ['undefined', '0', '1', '2', '3', '4', '5'].map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`))
        .concat([cache.del(`earliestReachableBlock:${chainId}`)])
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
        ['undefined', '0', '1', '2', '3', '4', '5'].map(blockNumber => cache.del(`getBlock:${chainId}:${blockNumber}`))
          .concat([cache.del(`earliestReachableBlock:${chainId}`)])
      )
    }
  })

  it('estimates height when block 0 and 1 are missing from the RPC', async function() {
    const originalNext = rpcs.next
    const chainId = 31339
    const earliest = 100n
    const tip = 200n

    await Promise.all(
      Array.from({ length: 201 }, (_, n) => cache.del(`getBlock:${chainId}:${String(n)}`))
        .concat([
          cache.del(`getBlock:${chainId}:undefined`),
          cache.del(`earliestReachableBlock:${chainId}`)
        ])
    )

    rpcs.next = ((chain: number) => {
      expect(chain).to.equal(chainId)
      return {
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
          const number = blockNumber ?? tip
          if (number < earliest) {
            throw new Error(`Block at number "${number}" could not be found.`)
          }
          return { number, timestamp: number * 10n }
        }
      }
    }) as unknown as typeof rpcs.next

    try {
      expect(await __estimateHeight(chainId, 1_500n)).to.equal(150n)
    } finally {
      rpcs.next = originalNext
      await Promise.all(
        Array.from({ length: 201 }, (_, n) => cache.del(`getBlock:${chainId}:${String(n)}`))
          .concat([
          cache.del(`getBlock:${chainId}:undefined`),
          cache.del(`earliestReachableBlock:${chainId}`)
        ])
      )
    }
  })

  it('does not cache a transient RPC error as the earliest reachable block', async function() {
    const originalNext = rpcs.next
    const chainId = 31340
    const tip = 200n
    const keys = Array.from({ length: 201 }, (_, n) => `getBlock:${chainId}:${String(n)}`)
      .concat([`getBlock:${chainId}:undefined`, `earliestReachableBlock:${chainId}`])

    await Promise.all(keys.map(key => cache.del(key)))

    rpcs.next = ((chain: number) => {
      expect(chain).to.equal(chainId)
      return {
        getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
          const number = blockNumber ?? tip
          if (number <= 1n) throw new Error(`Block at number "${number}" could not be found.`)
          if (number === tip - 1n) throw new Error('429 Too Many Requests')
          return { number, timestamp: number * 10n }
        }
      }
    }) as unknown as typeof rpcs.next

    try {
      let thrown: unknown
      try { await __estimateHeight(chainId, 1_500n) } catch (error) { thrown = error }
      expect(String(thrown)).to.include('429')
      expect(await cache.get(`earliestReachableBlock:${chainId}`)).to.be.undefined
    } finally {
      rpcs.next = originalNext
      await Promise.all(keys.map(key => cache.del(key)))
    }
  })
})
