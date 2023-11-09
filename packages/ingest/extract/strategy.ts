import { mq, multicall3, types } from 'lib'
import { parseAbi, zeroAddress } from 'viem'
import { Processor } from 'lib/processor'
import { Queue } from 'bullmq'
import { rpcs } from 'lib/rpcs'
import { estimateHeight } from 'lib/blocks'
import { fetchErc20PriceUsd } from 'lib/prices'
import { scaleDown } from 'lib/math'

export class StrategyExtractor implements Processor {
  queue: Queue | undefined

  async up() {
    this.queue = mq.queue(mq.q.load)
  }

  async down() {
    await this.queue?.close()
  }

  async extract(data: any) {
    const strategy = data as types.Strategy
    const asOfBlockNumber = await rpcs.next(strategy.chainId).getBlockNumber()

    if(!multicall3.supportsBlock(strategy.chainId, BigInt(asOfBlockNumber))) {
      console.warn('🚨', 'block not supported', strategy.chainId, asOfBlockNumber)
      return
    }

    const fields = await this.extractFields(strategy.chainId, strategy.vaultAddress, strategy.address)
    const activationBlockNumber = await estimateHeight(strategy.chainId, BigInt(fields.activationBlockTime || 0))

    const totalDebtUsd = await this.computeTotalDebtUsd(
      strategy,
      fields.totalDebt || 0n,
      fields.assetAddress as `0x${string}`,
      asOfBlockNumber
    )

    const update = {
      ...strategy,
      ...fields,
      totalDebtUsd,
      activationBlockNumber,
      asOfBlockNumber
    } as types.Strategy

    await this.queue?.add(
      mq.job.load.strategy, update
    )
  }

  private async computeTotalDebtUsd(strategy: types.Strategy, totalDebt: bigint, assetAddress: `0x${string}`, asOfBlockNumber: bigint) {
    const borked = [
      '0x718AbE90777F5B778B52D553a5aBaa148DD0dc5D'.toLowerCase()
    ]
    if(borked.includes(strategy.vaultAddress.toLowerCase())) return 0;

    const { price } = await fetchErc20PriceUsd(strategy.chainId, assetAddress, asOfBlockNumber)
    const decimals = await rpcs.next(strategy.chainId).readContract({
      address: assetAddress,
      functionName: 'decimals' as never,
      abi: parseAbi(['function decimals() view returns (uint8)']),
    }) as number
    return price * Number(scaleDown(totalDebt, decimals))
  }

  private async extractFields(chainId: number, vault: `0x${string}`, strategy: `0x${string}`) {
    const multicallResult = await rpcs.next(chainId).multicall({ contracts: [
      {
        address: strategy, functionName: 'name',
        abi: parseAbi(['function name() returns (string)'])
      },
      {
        address: strategy, functionName: 'apiVersion',
        abi: parseAbi(['function apiVersion() returns (string)'])
      },
      {
        address: strategy, functionName: 'want',
        abi: parseAbi(['function want() returns (address)'])
      },
      {
        address: vault, functionName: 'strategies', args: [strategy],
        abi: parseAbi(['function strategies(address) returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)'])
      },
      {
        address: strategy, functionName: 'estimatedTotalAssets',
        abi: parseAbi(['function estimatedTotalAssets() returns (uint256)'])
      },
      {
        address: strategy, functionName: 'delegatedAssets',
        abi: parseAbi(['function delegatedAssets() returns (uint256)'])
      }
    ]})

    return {
      name: multicallResult[0].result,
      apiVersion: multicallResult[1].result || '0.0.0',
      assetAddress: multicallResult[2].result || zeroAddress,
      performanceFee: multicallResult[3].result?.[0],
      activationBlockTime: multicallResult[3].result?.[1],
      debtRatio: multicallResult[3].result?.[2],
      minDebtPerHarvest: multicallResult[3].result?.[3],
      maxDebtPerHarvest: multicallResult[3].result?.[4],
      lastReportBlockTime: multicallResult[3].result?.[5],
      totalDebt: multicallResult[3].result?.[6],
      totalGain: multicallResult[3].result?.[7],
      totalLoss: multicallResult[3].result?.[8],
      estimatedTotalAssets: multicallResult[4].result,
      delegatedAssets: multicallResult[5].result
    } as types.Strategy
  }
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
