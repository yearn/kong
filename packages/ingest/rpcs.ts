import { rpcs as _rpcs } from 'lib/rpcs'

const FULL_NODE_DEPTH = BigInt(process.env.FULL_NODE_DEPTH || 400)
const MAX_HEAD_AGE_MS = 60_000

export const latestBlocks : {
  [chainId: number]: { blockNumber: bigint, blockTime: bigint, observedAt: number }
} = {}

function useArchiveNode(chainId: number, blockNumber?: bigint) {
  if (blockNumber === undefined) return false
  const head = latestBlocks[chainId]
  if(!head || Date.now() - head.observedAt > MAX_HEAD_AGE_MS) return true
  return blockNumber < head.blockNumber - FULL_NODE_DEPTH
}

export const rpcs = {
  up: async () => {
    await _rpcs.up()
  },

  down: async () => {
    await _rpcs.down()
  },

  next: (chainId: number, blockNumber?: bigint) => {
    const archive = useArchiveNode(chainId, blockNumber)
    return _rpcs.next(chainId, archive)
  }
}
