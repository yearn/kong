import { Queue, Worker } from 'bullmq'
import { mq, types } from 'lib'
import { PublicClient, createPublicClient, parseAbi, webSocket } from 'viem'
import { mainnet } from 'viem/chains'

export class VaultWorker implements types.Processor {
  queue: Queue
  rpc: PublicClient
  worker: Worker | undefined

  constructor() {
    this.queue = mq.queue(mq.n.load.vault)
    this.rpc = createPublicClient({
      chain: mainnet, transport: webSocket(process.env.WSS_NETWORK_1)
    })
  }

  async up() {
    this.worker = mq.worker(mq.n.extract.vault, async job => {
      try {
        const vault = job.data as types.Vault
        const result = await this.rpc.multicall({
          contracts: [
            {
              address: vault.address as `0x${string}`,
              abi: parseAbi(['function name() returns (string)']),
              functionName: 'name'
            },
            {
              address: vault.address as `0x${string}`,
              abi: parseAbi(['function symbol() returns (string)']),
              functionName: 'symbol'
            },
            {
              address: vault.address as `0x${string}`,
              abi: parseAbi(['function decimals() returns (uint32)']),
              functionName: 'decimals'
            },
            {
              address: vault.address as `0x${string}`,
              abi: parseAbi(['function totalAssets() returns (uint256)']),
              functionName: 'totalAssets'
            },
            {
              address: vault.baseAssetAddress as `0x${string}`,
              abi: parseAbi(['function name() returns (string)']),
              functionName: 'name'
            },
            {
              address: vault.baseAssetAddress as `0x${string}`,
              abi: parseAbi(['function symbol() returns (string)']),
              functionName: 'symbol'
            },
          ]
        })

        const update = {
          ...vault,
          name: result[0].result,
          symbol: result[1].result,
          decimals: result[2].result,
          totalAssets: result[3].result?.toString(),
          baseAssetName: result[4].result,
          baseAssetSymbol: result[5].result,
        } as types.Vault
  
        await this.queue.add(mq.n.load.vault, update)
        return true
      } catch (error) {
        console.error('🤬', error)
        return false
      }
    })
  }

  async down() {
    await this.queue.close()
    await this.worker?.close()
  }
}