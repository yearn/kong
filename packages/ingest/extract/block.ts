import { z } from 'zod'
import { mq, types } from 'lib'
import { latestBlocks, rpcs } from '../rpcs'

export class BlockExtractor {
  async extract(data: unknown) {
    const { chainId } = z.object({ chainId: z.number().int().positive() }).parse(data)
    const rpc = rpcs.next(chainId)
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
