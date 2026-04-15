import { estimateHeight, getBlock } from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import { Output, OutputSchema } from 'lib/types'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { Data } from '../../../../../../extract/timeseries'
import { computeApy, computeNetApr, extractFees__v3 } from '../../../../lib/apy'
import { projectStrategies } from '../../snapshot/hook'
import { V3_ORACLE_ABI } from './abi'
import { getOracleConfig } from './constants'

export { computeNetApr } from '../../../../lib/apy'

export const outputLabel = 'apr-oracle'

function parseApr(rawApr: bigint): number | undefined {
  const apr = Number(rawApr) / 1e18
  if (isNaN(apr) || !isFinite(apr)) return undefined
  return apr
}

function isExpectedStrategyAprFallback(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false
  return !!error.walk(cause => cause instanceof ContractFunctionRevertedError)
}

export async function readApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
): Promise<number | undefined> {
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })

    return parseApr(rawApr)
  } catch (error) {
    if (!isExpectedStrategyAprFallback(error)) throw error
  }

  try {
    // Fallback: regular vaults without a registered strategy oracle revert on
    // getStrategyApr. getCurrentApr returns APR based on the vault's profit-unlocking rate.
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getCurrentApr',
      args: [address],
      blockNumber,
    })
    return parseApr(rawApr)
  } catch {
    return undefined
  }
}

export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const oracleConfig = getOracleConfig(chainId)
  if (!oracleConfig) {
    return []
  }

  let blockNumber: bigint

  if (data.blockTime >= BigInt(Math.floor(Date.now() / 1000))) {
    blockNumber = (await getBlock(chainId)).number
  } else {
    blockNumber = await estimateHeight(chainId, data.blockTime)
  }

  if (blockNumber < oracleConfig.inceptBlock) {
    return []
  }

  const apr = await readApr(chainId, address, blockNumber, oracleConfig.address)
  if (apr === undefined) return []

  const apy = computeApy(apr)

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(chainId, address, blockNumber)
    fees = await extractFees__v3(chainId, address, strategies, blockNumber)
  } catch (error) {
    console.warn('🚨', 'apr-oracle fee fetch failed', chainId, address, String(blockNumber), error)
  }

  const netApr = computeNetApr(apr, fees)
  const netApy = computeApy(netApr)

  const outputs: Output[] = [
    {
      label: outputLabel,
      component: 'apr',
      value: apr,
      chainId,
      address,
      blockNumber,
      blockTime: data.blockTime,
    },
    {
      label: outputLabel,
      component: 'apy',
      value: apy,
      chainId,
      address,
      blockNumber,
      blockTime: data.blockTime,
    },
    {
      label: outputLabel,
      component: 'netApr',
      value: netApr,
      chainId,
      address,
      blockNumber,
      blockTime: data.blockTime,
    },
    {
      label: outputLabel,
      component: 'netApy',
      value: netApy,
      chainId,
      address,
      blockNumber,
      blockTime: data.blockTime,
    },
  ]

  return OutputSchema.array().parse(outputs)
}
