import { describe, expect, it, vi } from 'vitest'
import { __estimateHeight } from './blocks'

const targetTimestamp = 1716356553n
const targetBlock = 19923412n
const genesisTimestamp = targetTimestamp - targetBlock * 12n

vi.mock('./rpcs', () => ({
  rpcs: {
    next: () => ({
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
        const number = blockNumber ?? 19923420n
        return {
          number,
          timestamp: genesisTimestamp + number * 12n
        }
      }
    })
  }
}))

describe('blocks', function() {
  it('estimates block height', async function() {
    const result = await __estimateHeight(1, targetTimestamp)
    const ranged = result >= 19923410n && result <= 19923414n
    if (!ranged) console.error ('result', result)
    expect (ranged).to.be.true
  }, 5_000)
})
