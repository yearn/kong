import { rpcs as _rpcs } from 'lib/rpcs'

const FULL_NODE_DEPTH = BigInt(process.env.FULL_NODE_DEPTH || 400)

export const latestBlocks : {
  [chainId: number]: { blockNumber: bigint, blockTime: bigint }
} = {}

function useArchiveNode(chainId: number, blockNumber?: bigint) {
  if (blockNumber === undefined) return false
  if(!latestBlocks[chainId]) return true
  return blockNumber < latestBlocks[chainId].blockNumber - FULL_NODE_DEPTH
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
