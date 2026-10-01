import { mq, types } from 'lib'
import { latestBlocks, rpcs } from '../rpcs'

export class BlockExtractor {
  async extract(data: { chainId: number }) {
    const rpc = rpcs.next(data.chainId)
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
