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

export type OracleAprSource = 'getStrategyApr' | 'getCurrentApr'

type OracleAprRead = {
  apr: number
  source: OracleAprSource
}

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
): Promise<OracleAprRead | undefined> {
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })

    const apr = parseApr(rawApr)
    return apr === undefined ? undefined : { apr, source: 'getStrategyApr' }
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
    console.warn('🚨', 'apr-oracle getCurrentApr success', chainId, address, String(blockNumber), rawApr)
    const apr = parseApr(rawApr)
    return apr === undefined ? undefined : { apr, source: 'getCurrentApr' }
  } catch {
    console.warn('🚨', 'apr-oracle getCurrentApr failed', chainId, address, String(blockNumber))
    return undefined
  }
}

// Resolve the oracle apr/apy for any vault address at a given blockTime. Shared
// with the erc4626 apr-oracle hook — the oracle prices vaults purely by address,
// so both v3 and plain erc4626 vaults go through here.
export async function resolveOracleApr(
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<{ apr: number, apy: number, source: OracleAprSource, blockNumber: bigint } | undefined> {
  const oracleConfig = getOracleConfig(chainId)
  if (!oracleConfig) return undefined

  const blockNumber = data.blockTime >= BigInt(Math.floor(Date.now() / 1000))
    ? (await getBlock(chainId)).number
    : await estimateHeight(chainId, data.blockTime)

  if (blockNumber < oracleConfig.inceptBlock) return undefined

  const read = await readApr(chainId, address, blockNumber, oracleConfig.address)
  if (!read) return undefined

  return { apr: read.apr, apy: computeApy(read.apr), source: read.source, blockNumber }
}

export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const resolved = await resolveOracleApr(chainId, address, data)
  if (!resolved) return []
  const { apr, apy, blockNumber } = resolved

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(chainId, address, blockNumber)
    fees = await extractFees__v3(chainId, address, strategies, blockNumber)
  } catch (error) {
    console.warn('🚨', 'apr-oracle fee fetch failed', chainId, address, String(blockNumber), error)
  }

  const netApr = computeNetApr(apr, fees)

  const output = (component: string, value: number): Output => ({
    label: outputLabel, component, value, chainId, address, blockNumber, blockTime: data.blockTime,
  })

  return OutputSchema.array().parse([
    output('apr', apr),
    output('apy', apy),
    output(`source:${resolved.source}`, 1),
    output('netApr', netApr),
    output('netApy', computeApy(netApr)),
  ])
}
