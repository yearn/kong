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
})
