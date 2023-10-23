import { math, mq, multicall3, types } from 'lib'
import { blocks } from 'lib'
import { parseAbi, stringToBytes, zeroAddress } from 'viem'
import { Processor } from 'lib/processor'
import { Queue } from 'bullmq'
import { rpcs } from 'lib/rpcs'
import db from '../db'
import { estimateCreationBlock } from 'lib/blocks'

export class VaultExtractor implements Processor {
  queues: {
    [name: string]: Queue
  } = {}

  async up() {
    this.queues[mq.q.load] = mq.queue(mq.q.load)
    this.queues[mq.q.extract] = mq.queue(mq.q.extract)
  }

  async down() {
    await Promise.all(Object.values(this.queues).map(queue => queue.close()))
  }

  async extract(data: any) {
    const vault = data as types.Vault
    const asOfBlockNumber = await rpcs.next(vault.chainId).getBlockNumber()

    if(!multicall3.supportsBlock(vault.chainId, asOfBlockNumber)) {
      console.warn('🚨', 'block not supported', vault.chainId, asOfBlockNumber)
      return
    }

    const fields = await this.extractFields(vault.chainId, vault.address)
    const asset = await this.extractAsset(vault.chainId, fields.assetAddress as `0x${string}`)
    const activation = await this.extractActivation(vault.chainId, vault.address)
    const withdrawalQueue = await extractWithdrawalQueue(vault.chainId, vault.address, asOfBlockNumber)

    const update = {
      ...vault,
      ...fields,
      ...asset,
      ...activation,
      asOfBlockNumber
    } as types.Vault

    await this.queues[mq.q.load].add(
      mq.job.load.erc20, {
        chainId: vault.chainId,
        address: fields.assetAddress,
        name: asset.assetName,
        symbol: asset.assetSymbol,
        decimals: fields.decimals
      }
    )

    await this.queues[mq.q.load].add(
      mq.job.load.erc20, {
        chainId: vault.chainId,
        address: vault.address,
        name: fields.name,
        symbol: fields.symbol,
        decimals: fields.decimals
      }
    )

    await this.queues[mq.q.load].add(
      mq.job.load.vault, update
    )

    await this.queues[mq.q.load].add(
      mq.job.load.withdrawalQueue, { batch: withdrawalQueue.map((strategyAddress, queueIndex) => ({
        chainId: vault.chainId,
        vaultAddress: vault.address,
        queueIndex, strategyAddress, asOfBlockNumber
    })) as types.WithdrawalQueueItem[] })

    for(const strategy of withdrawalQueue) {
      if(!strategy || strategy === zeroAddress) continue
      await this.queues[mq.q.extract].add(
        mq.job.extract.strategy, {
          chainId: vault.chainId,
          address: strategy,
          vaultAddress: vault.address,
          asOfBlockNumber
      } as types.Strategy)
    }
  }

  private async extractFields(chainId: number, address: `0x${string}`) {
    const multicallResult = await rpcs.next(chainId).multicall({ contracts: [
      {
        address, functionName: 'name',
        abi: parseAbi(['function name() returns (string)'])
      },
      {
        address, functionName: 'symbol',
        abi: parseAbi(['function symbol() returns (string)'])
      },
      {
        address, functionName: 'decimals',
        abi: parseAbi(['function decimals() returns (uint32)'])
      },
      {
        address, functionName: 'totalAssets',
        abi: parseAbi(['function totalAssets() returns (uint256)'])
      },
      {
        address, functionName: 'apiVersion',
        abi: parseAbi(['function apiVersion() returns (string)'])
      },
      {
        address, functionName: 'api_version',
        abi: parseAbi(['function api_version() returns (string)'])
      },
      {
        address, functionName: 'token',
        abi: parseAbi(['function token() returns (address)'])
      }, 
      {
        address, functionName: 'asset',
        abi: parseAbi(['function asset() returns (address)'])
      }
    ]})

    return {
      name: multicallResult[0].result,
      symbol: multicallResult[1].result,
      decimals: multicallResult[2].result,
      totalAssets: multicallResult[3].result?.toString(),
      apiVersion: multicallResult[4].result || multicallResult[5].result || '0.0.0',
      assetAddress: multicallResult[6].result || multicallResult[7].result
    } as types.Vault
  }
  
  private async extractAsset(chainId: number, address: `0x${string}`) {
    const result = await rpcs.next(chainId).multicall({ contracts: [
      {
        address, functionName: 'name',
        abi: parseAbi(['function name() returns (string)'])
      },
      {
        address, functionName: 'symbol',
        abi: parseAbi(['function symbol() returns (string)'])
      }
    ]})
  
    return {
      assetName: result[0].result,
      assetSymbol: result[1].result
    }
  }

  private async extractActivation(chainId: number, address: `0x${string}`) {
    const { activation_block_time, activation_block_number } = (await db.query(
      `SELECT
        FLOOR(EXTRACT(EPOCH FROM activation_block_time)) as activation_block_time,
        activation_block_number
      FROM
        vault
      WHERE
        chain_id = $1 AND address = $2`, 
      [chainId, address]
    )).rows[0] || {}

    if(activation_block_time) return {
      activationBlockTime: activation_block_time.toString(),
      activationBlockNumber: activation_block_number as bigint
    }

    try {
      const activationBlockTime = await rpcs.next(chainId).readContract({
        address, functionName: 'activation' as never,
        abi: parseAbi(['function activation() returns (uint256)'])
      }) as bigint

      return {
        activationBlockTime: activationBlockTime.toString(),
        activationBlockNumber: (await blocks.estimateHeight(chainId, activationBlockTime)).toString()
      }
    } catch(error) {
      console.warn('🚨', chainId, address, '!activation field')
      const createBlock = await estimateCreationBlock(chainId, address)
      return {
        activationBlockTime: createBlock.timestamp.toString(),
        activationBlockNumber: createBlock.number.toString()
      }
    }
  }
}

export async function extractFees(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const bps = await extractFeesBps(chainId, address, blockNumber)
  return {
    performance: math.div(bps.performance, 10_000n),
    management: math.div(bps.management, 10_000n)
  }
}

export async function extractFeesBps(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const multicallResult = await rpcs.next(chainId).multicall({ contracts: [
    {
      address, functionName: 'performanceFee',
      abi: parseAbi(['function performanceFee() returns (uint256)'])
    },
    {
      address, functionName: 'managementFee',
      abi: parseAbi(['function managementFee() returns (uint256)'])
    }
  ], blockNumber })

  return {
    performance: multicallResult[0].result || 0n,
    management: multicallResult[1].result || 0n
  }
}

export async function extractWithdrawalQueue(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  // TODO: y dis no work? runtime error 'property abi cannot be destructured'
  // const contracts = Array(20).map((_, i) => ({
  //   address, functionName: 'withdrawalQueue', args: [BigInt(i)],
  //   abi: parseAbi(['function withdrawalQueue(uint256) returns (address)'])    
  // }))
  // const results = await rpc.multicall({ contracts })
  //

  const results = await rpcs.next(chainId).multicall({ contracts: [
    { args: [0n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [1n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [2n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [3n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [4n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [5n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [6n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [7n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [8n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [9n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [10n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [11n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [12n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [13n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [14n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [15n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [16n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [17n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [18n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
    { args: [19n], address, functionName: 'withdrawalQueue', abi: parseAbi(['function withdrawalQueue(uint256) returns (address)']) },
  ], blockNumber})

  return results.filter(result => result.status === 'success')
  .map(result => result.result as `0x${string}`)
}

export async function extractDelegatedAssets(chainId: number, addresses: `0x${string}` [], blockNumber: bigint) {
  const results = [] as { address: `0x${string}`, delegatedAssets: bigint } []

  const contracts = addresses.map(address => ({
    args: [], address, functionName: 'delegatedAssets', abi: parseAbi(['function delegatedAssets() returns (uint256)'])
  }))

  const multicallresults = await rpcs.next(chainId).multicall({ contracts, blockNumber})

  multicallresults.forEach((result, index) => {
    const delegatedAssets = result.status === 'failure'
    ? 0n
    : BigInt(result.result as bigint)

    results.push({ address: addresses[index], delegatedAssets })
  })

  return results
}
