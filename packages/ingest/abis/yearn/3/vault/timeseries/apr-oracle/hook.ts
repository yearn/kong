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

// On the getStrategyApr-revert fallback the resolved apr IS getCurrentApr, so
// `currentApr` is surfaced there for callers to reuse instead of re-reading it.
export async function readApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
): Promise<{ apr: number | undefined, currentApr: number | undefined }> {
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getStrategyApr',
      args: [address, 0n],
      blockNumber,
    })

    return { apr: parseApr(rawApr), currentApr: undefined }
  } catch (error) {
    if (!isExpectedStrategyAprFallback(error)) throw error
  }

  // Fallback: regular vaults without a registered strategy oracle revert on
  // getStrategyApr. getCurrentApr returns APR based on the vault's profit-unlocking rate.
  const currentApr = await readCurrentApr(chainId, address, blockNumber, oracleAddress)
  return { apr: currentApr, currentApr }
}

// Direct getCurrentApr read; tolerates reverts by returning undefined.
export async function readCurrentApr(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  oracleAddress: `0x${string}`,
): Promise<number | undefined> {
  try {
    const rawApr = await rpcs.next(chainId).readContract({
      abi: V3_ORACLE_ABI,
      address: oracleAddress,
      functionName: 'getCurrentApr',
      args: [address],
      blockNumber,
    })
    return parseApr(rawApr)
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
): Promise<{
  apr: number,
  apy: number,
  blockNumber: bigint,
  currentApr: number | undefined,
  oracleAddress: `0x${string}`,
} | undefined> {
  const oracleConfig = getOracleConfig(chainId)
  if (!oracleConfig) return undefined

  const blockNumber = data.blockTime >= BigInt(Math.floor(Date.now() / 1000))
    ? (await getBlock(chainId)).number
    : await estimateHeight(chainId, data.blockTime)

  if (blockNumber < oracleConfig.inceptBlock) return undefined

  const { apr, currentApr } = await readApr(chainId, address, blockNumber, oracleConfig.address)
  if (apr === undefined) return undefined

  return { apr, apy: computeApy(apr), blockNumber, currentApr, oracleAddress: oracleConfig.address }
}

// Pure so the component names and APY/net math are unit-testable. current*
// components are appended only when a getCurrentApr value is present.
export function buildOracleComponents(
  apr: number,
  fees: { management: number, performance: number },
  currentApr?: number,
): { component: string, value: number }[] {
  const netApr = computeNetApr(apr, fees)
  const components = [
    { component: 'apr', value: apr },
    { component: 'apy', value: computeApy(apr) },
    { component: 'netApr', value: netApr },
    { component: 'netApy', value: computeApy(netApr) },
  ]

  if (currentApr !== undefined) {
    const currentNetApr = computeNetApr(currentApr, fees)
    components.push(
      { component: 'currentApr', value: currentApr },
      { component: 'currentApy', value: computeApy(currentApr) },
      { component: 'currentNetApr', value: currentNetApr },
      { component: 'currentNetApy', value: computeApy(currentNetApr) },
    )
  }

  return components
}

export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const resolved = await resolveOracleApr(chainId, address, data)
  if (!resolved) return []
  const { apr, blockNumber, oracleAddress } = resolved

  let fees = { management: 0, performance: 0 }
  try {
    const strategies = await projectStrategies(chainId, address, blockNumber)
    fees = await extractFees__v3(chainId, address, strategies, blockNumber)
  } catch (error) {
    console.warn('🚨', 'apr-oracle fee fetch failed', chainId, address, String(blockNumber), error)
  }

  // Reuse the fallback's getCurrentApr when present; otherwise read it (the
  // strategy path succeeded, so current APR is a distinct value).
  const currentApr = resolved.currentApr !== undefined
    ? resolved.currentApr
    : await readCurrentApr(chainId, address, blockNumber, oracleAddress)

  const output = (component: string, value: number): Output => ({
    label: outputLabel, component, value, chainId, address, blockNumber, blockTime: data.blockTime,
  })

  return OutputSchema.array().parse(
    buildOracleComponents(apr, fees, currentApr).map(c => output(c.component, c.value)),
  )
}
