import { Output, OutputSchema } from 'lib/types'
import { estimateHeight, getBlock } from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import { Data } from '../../../../../../extract/timeseries'
import { V3_ORACLE_ABI } from './abi'
import { getOracleConfig } from './constants'

export const outputLabel = 'apr-oracle'

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

  let apr = 0
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleConfig.address,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })
    apr = Number(rawApr) / 1e18
  } catch {
    apr = 0
  }

  if (isNaN(apr) || !isFinite(apr)) {
    apr = 0
  }

  const apy = (1 + apr / 52) ** 52 - 1

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
  ]

  return OutputSchema.array().parse(outputs)
}
