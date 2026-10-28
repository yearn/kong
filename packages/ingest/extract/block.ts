import { chains, mq, types } from 'lib'
import { latestBlocks, rpcs } from '../rpcs'

export class BlockExtractor {
  async extract(data: { chainId?: number } = {}) {
    // Current repeatables are per chain; keep old root-queue jobs compatible.
    const targets = data.chainId === undefined
      ? chains
      : chains.filter(chain => chain.id === data.chainId)
    if (targets.length === 0) throw new Error(`Unknown block job chain: ${data.chainId}`)
    for(const chain of targets) {
      const rpc = rpcs.next(chain.id)
      const block = await rpc.getBlock()

      latestBlocks[rpc.chain?.id as number] = {
        blockNumber: block.number,
        blockTime: block.timestamp
      }

      await mq.add(mq.job.load.block, {
        chainId: rpc.chain?.id,
        blockNumber: block.number,
        blockTime: block.timestamp
      } as types.LatestBlock, {
        jobId: `${rpc.chain?.id}-${block.number}`
      })
    }
  }
}
