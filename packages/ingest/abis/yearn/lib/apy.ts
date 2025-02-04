import { z } from 'zod'
import { Data } from '../../../extract/timeseries'
import { EvmLog, EvmLogSchema, Output, OutputSchema, Thing, ThingSchema, zhexstring } from 'lib/types'
import { first, query } from '../../../db'
import { estimateHeight, getBlock } from 'lib/blocks'
import { math, multicall3 } from 'lib'
import { ReadContractParameters, parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
import { rpcs } from '../../../rpcs'
import { compare } from 'compare-versions'
import * as snapshot__v2 from '../2/vault/snapshot/hook'
import * as snapshot__v3 from '../3/vault/snapshot/hook'
import { extractFeesBps } from '../2/strategy/event/hook'

export const APYSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  weeklyNet: z.number().optional(),
  weeklyPricePerShare: z.bigint({ coerce: true }).optional(),
  weeklyBlockNumber: z.bigint({ coerce: true }),
  monthlyNet: z.number().optional(),
  monthlyPricePerShare: z.bigint({ coerce: true }).optional(),
  monthlyBlockNumber: z.bigint({ coerce: true }),
  inceptionNet: z.number().optional(),
  inceptionPricePerShare: z.bigint({ coerce: true }).optional(),
  inceptionBlockNumber: z.bigint({ coerce: true }),
  net: z.number().optional(),
  grossApr: z.number().optional(),
  pricePerShare: z.bigint({ coerce: true }),
  lockedProfit: z.bigint({ coerce: true }).optional(),
  blockNumber: z.bigint({ coerce: true }),
  blockTime: z.bigint({ coerce: true })
})

export type APY = z.infer<typeof APYSchema>

export default async function _process(chainId: number, address: `0x${string}`, label: 'vault' | 'strategy', data: Data): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  let blockNumber: bigint = 0n
  if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
    blockNumber = (await getBlock(chainId)).number
  } else {
    blockNumber = await estimateHeight(chainId, data.blockTime)
  }

  if(!multicall3.supportsBlock(chainId, blockNumber)) {
    console.warn('🚨', 'block not supported', chainId, blockNumber)
    return []
  }

  const vault = await first<Thing>(ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, label]
  )

  if (!vault) return []

  const strategies: `0x${string}`[] = []
  if (compare(vault.defaults.apiVersion, '3.0.0', '>=')) {
    strategies.push(...await snapshot__v3.projectStrategies(chainId, address, blockNumber))
  } else {
    strategies.push(...await snapshot__v2.projectStrategies(chainId, address, blockNumber))
  }

  const apy = await _compute(vault, strategies, blockNumber)
  if (!apy) return []

  return OutputSchema.array().parse([
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'net', value: apy.net
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'grossApr', value: apy.grossApr
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'pricePerShare', value: Number(apy.pricePerShare)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'weeklyNet', value: apy.weeklyNet
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'weeklyPricePerShare', value: Number(apy.weeklyPricePerShare)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'weeklyBlockNumber', value: Number(apy.weeklyBlockNumber)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'monthlyNet', value: apy.monthlyNet
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'monthlyPricePerShare', value: Number(apy.monthlyPricePerShare)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'monthlyBlockNumber', value: Number(apy.monthlyBlockNumber)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'inceptionNet', value: apy.inceptionNet
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'inceptionPricePerShare', value: Number(apy.inceptionPricePerShare)
    },
    {
      chainId, address, blockNumber: apy.blockNumber, blockTime: apy.blockTime,
      label: data.outputLabel, component: 'inceptionBlockNumber', value: Number(apy.inceptionBlockNumber)
    }
  ])
}

export async function _compute(vault: Thing, strategies: `0x${string}`[], blockNumber: bigint) {
  const { chainId, address } = vault
  const block = await getBlock(chainId, blockNumber)

  const result = APYSchema.parse({
    chainId,
    address,
    weeklyNet: undefined,
    weeklyPricePerShare: 0n,
    weeklyBlockNumber: 0n,
    monthlyNet: undefined,
    monthlyPricePerShare: 0n,
    monthlyBlockNumber: 0n,
    inceptionNet: undefined,
    inceptionPricePerShare: 0n,
    inceptionBlockNumber: 0n,
    net: undefined,
    grossApr: undefined,
    pricePerShare: 0n,
    blockNumber,
    blockTime: block.timestamp,
  })

  const inceptionBlockNumber = await getInceptionBlockNumber(vault, blockNumber)
  if (!inceptionBlockNumber) return result

  result.inceptionBlockNumber = inceptionBlockNumber

  const ppsParameters = {
    address, functionName: 'pricePerShare' as never,
    abi: parseAbi(['function pricePerShare() view returns (uint256)'])
  } as ReadContractParameters

  const day = 24n * 60n * 60n
  result.weeklyBlockNumber = await estimateHeight(chainId, block.timestamp - 7n * day)
  result.monthlyBlockNumber = await estimateHeight(chainId, block.timestamp - 30n * day)

  result.pricePerShare = await rpcs.next(chainId, blockNumber).readContract({...ppsParameters, blockNumber}) as bigint
  result.inceptionPricePerShare = await rpcs.next(chainId, result.inceptionBlockNumber).readContract({...ppsParameters, blockNumber: result.inceptionBlockNumber}) as bigint

  if (result.pricePerShare === result.inceptionPricePerShare) return result

  result.weeklyPricePerShare = result.weeklyBlockNumber < result.inceptionBlockNumber ? undefined : await rpcs.next(chainId, result.weeklyBlockNumber).readContract({...ppsParameters, blockNumber: result.weeklyBlockNumber}) as bigint
  result.monthlyPricePerShare = result.monthlyBlockNumber < result.inceptionBlockNumber ? undefined : await rpcs.next(chainId, result.monthlyBlockNumber).readContract({...ppsParameters, blockNumber: result.monthlyBlockNumber}) as bigint

  const blocksPerDay = (blockNumber - result.weeklyBlockNumber) / 7n

  result.weeklyNet = result.weeklyPricePerShare === undefined ? undefined : compoundAndAnnualizeDelta(
    { block: result.weeklyBlockNumber, pps: result.weeklyPricePerShare },
    { block: blockNumber, pps: result.pricePerShare }, blocksPerDay
  )

  result.monthlyNet = result.monthlyPricePerShare === undefined ? undefined : compoundAndAnnualizeDelta(
    { block: result.monthlyBlockNumber, pps: result.monthlyPricePerShare },
    { block: blockNumber, pps: result.pricePerShare }, blocksPerDay
  )

  result.inceptionNet = compoundAndAnnualizeDelta(
    { block: result.inceptionBlockNumber, pps: result.inceptionPricePerShare },
    { block: blockNumber, pps: result.pricePerShare }, blocksPerDay
  )

  const candidates: (number | undefined)[] = []
  if(chainId !== mainnet.id) {
    candidates.push(result.weeklyNet, result.monthlyNet, result.inceptionNet)
  } else {
    candidates.push(result.monthlyNet, result.weeklyNet, result.inceptionNet)
  }

  result.net = candidates.find(apy => apy !== undefined) ?? (() => { throw new Error('!candidates') })()

  const annualCompoundingPeriods = 52
  const fees = compare(vault.defaults.apiVersion, '3.0.0', '>=')
    ? await extractFees__v3(chainId, address, strategies, blockNumber)
    : await extractFees__v2(chainId, address, strategies, blockNumber)

  const netApr = result.net > 0
    ? annualCompoundingPeriods * Math.pow(result.net + 1, 1 / annualCompoundingPeriods) - annualCompoundingPeriods
    : 0

  result.grossApr = fees.performance === 1
    ? netApr + fees.management
    : netApr / (1 - fees.performance) + fees.management

  if(result.net < 0) {
    if(compare(vault.defaults.apiVersion, '0.3.5', '>=')) {
      result.net = 0
    }
  }

  result.lockedProfit = compare(vault.defaults.apiVersion, '3.0.0', '>=')
    ? await extractLockedProfit__v3(chainId, address, blockNumber)
    : await extractLockedProfit__v2(chainId, address, blockNumber)

  return result
}

async function getInceptionBlockNumber(vault: Thing, blockNumber: bigint) {
  const { chainId, address } = vault
  const [first, second] = await getFirstTwoHarvestBlocks(vault)

  if(!(first && second)) {
    console.warn('🚨', 'harvests < 2', chainId, address)
    return undefined
  }

  if(first > blockNumber) {
    console.warn('🚨', 'first > blockNumber', chainId, address)
    return undefined
  }

  return first
}

export async function extractFees__v2(chainId: number, vault: `0x${string}`, strategies: `0x${string}`[], blockNumber: bigint) {
  const strategiesMulticall = await rpcs.next(chainId, blockNumber).multicall({ contracts: strategies.map(s => ({
    args: [s as string], address: vault, functionName: 'strategies',
    abi: parseAbi(['function strategies(address) returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256)'])
  })), blockNumber})

  const strategistFeesBps = strategiesMulticall.map(strategy => {
    if(strategy.status === 'failure') return 0n
    const fees = (strategy.result as bigint [])[0]
    const debtRatio = (strategy.result as bigint [])[2]
    return (fees * debtRatio) || 0n
  }).reduce((a, b) => a + b, 0n)

  const vaultFeesBps = await extractFeesBps(chainId, vault, blockNumber)

  return {
    performance: math.div(strategistFeesBps + vaultFeesBps.performance, 10_000n),
    management: math.div(vaultFeesBps.management, 10_000n)
  }
}

async function getFirstTwoHarvestBlocks(vault: Thing) {
  const harvests = await query<EvmLog>(EvmLogSchema, `
  SELECT * FROM evmlog WHERE chain_id = $1 AND address = $2 AND event_name IN ('StrategyReported', 'Reported')
  ORDER BY block_number, log_index LIMIT 2`,
  [vault.chainId, vault.address])
  return harvests.map(h => h.blockNumber)
}

function compoundAndAnnualizeDelta(
  before: { block: bigint, pps: bigint },
  after: { block: bigint, pps: bigint },
  blocksPerDay: bigint
) {
  const delta = math.div(after.pps - before.pps, before.pps || 1n)
  const period = math.div((BigInt(after.block) - BigInt(before.block)), blocksPerDay)
  return Math.pow(1 + delta, 365.2425 / period) - 1
}

export async function extractFees__v3(chainId: number, vault: `0x${string}`, strategies: `0x${string}`[], blockNumber: bigint) {
  const accountant = await extractAccountant(chainId, vault, blockNumber)
  if(!accountant) {
    try {
      const performanceFeeBps = await rpcs.next(chainId, blockNumber).readContract({
        address: vault,
        abi: parseAbi(['function performanceFee() view returns (uint16)']),
        functionName: 'performanceFee'
      })
      return {
        performance: performanceFeeBps / 10_000,
        management: 0
      }
    } catch(error) {
      console.warn('🚨', '!accountant && !performanceFees')
      return {
        performance: 0,
        management: 0
      }
    }
  }

  if(strategies.length === 0) return { performance: 0, management: 0 }

  const strategyMulticalls = strategies.map(s => [
    {
      address: vault,
      abi: parseAbi(['function strategies(address) view returns (uint256, uint256, uint256, uint256)']),
      functionName: 'strategies',
      args: [s as string]
    },
    {
      address: accountant,
      abi: parseAbi(['function useCustomConfig(address, address) view returns (bool)']),
      functionName: 'useCustomConfig',
      args: [vault, s as string]
    },
    {
      address: accountant,
      abi: parseAbi(['function customConfig(address, address) view returns (uint16, uint16, uint16, uint16, uint16, uint16)']),
      functionName: 'customConfig',
      args: [vault, s as string]
    }
  ]).flat()

  const extraMulticalls = [
    {
      address: accountant,
      abi: parseAbi(['function defaultConfig() view returns (uint16, uint16, uint16, uint16, uint16, uint16)']),
      functionName: 'defaultConfig'
    },
    {
      address: vault,
      abi: parseAbi(['function totalDebt() view returns (uint256)']),
      functionName: 'totalDebt'
    }
  ]

  const multicallResult = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    ...extraMulticalls,
    ...strategyMulticalls
  ], blockNumber})

  const defaultConfig = multicallResult[0]
  const defaultManagementFee = defaultConfig.status === 'success' ?  (defaultConfig.result as readonly [number, number, number, number, number, number])[0] : 0
  const defaultPerformanceFee = defaultConfig.status === 'success' ?  (defaultConfig.result as readonly [number, number, number, number, number, number])[1] : 0
  const totalDebt = multicallResult[1].result as bigint
  const feesBps = { management: 0, performance: 0 }

  for(let i = 0; i < strategies.length; i++) {
    const vaultParameters = multicallResult[i * 3 + 2 + 0]
    const [ activation, lastReport, currentDebt, maxDebt ] = vaultParameters.result as readonly [bigint, bigint, bigint, bigint]
    const debtRatio = math.div(currentDebt, totalDebt)

    const useCustomConfig = multicallResult[i * 3 + 2 + 1]
    if(useCustomConfig.result as boolean) {
      const customConfig = multicallResult[i * 3 + 2 + 2]
      const [ managementFee, performanceFee, refundRatio, maxFee, maxGain, maxLoss ] = customConfig.result as readonly [number, number, number, number, number, number]
      feesBps.management += debtRatio * managementFee
      feesBps.performance += debtRatio * performanceFee
    } else {
      feesBps.management += debtRatio * defaultManagementFee
      feesBps.performance += debtRatio * defaultPerformanceFee
    }
  }

  return {
    management: feesBps.management / 10_000,
    performance: feesBps.performance / 10_000
  }
}

async function extractAccountant(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  try {
    return await rpcs.next(chainId, blockNumber).readContract({
      address,
      abi: parseAbi(['function accountant() view returns (address)']),
      functionName: 'accountant'
    })
  } catch(error) {
    return undefined
  }
}

export async function extractLockedProfit__v2(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const DEGRADATION_COEFFICIENT = 10n ** 18n
  const multicallResult = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    {
      address, functionName: 'lastReport',
      abi: parseAbi(['function lastReport() view returns (uint256)'])
    },
    {
      address, functionName: 'lockedProfit',
      abi: parseAbi(['function lockedProfit() view returns (uint256)'])
    },
    {
      address, functionName: 'lockedProfitDegradation',
      abi: parseAbi(['function lockedProfitDegradation() view returns (uint256)'])
    }
  ], blockNumber })

  if(multicallResult.some(r => r.status === 'failure')) {
    console.warn('🚨', 'extractLockedProfit__v2', 'multicall fail', chainId, address, blockNumber)
    return undefined
  }

  const lastReport = multicallResult[0].result as bigint
  const lockedProfit = multicallResult[1].result as bigint
  const lockedProfitDegradation = multicallResult[2].result as bigint

  const lockedFundsRatio = (blockNumber - lastReport) * lockedProfitDegradation
  if(lockedFundsRatio < DEGRADATION_COEFFICIENT) {
    return lockedProfit - BigInt(Math.floor(math.div(lockedFundsRatio * lockedProfit, DEGRADATION_COEFFICIENT)))
  } else {
    return 0n
  }
}

export async function extractLockedProfit__v3(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  try {
    const shares = await rpcs.next(chainId, blockNumber).readContract({
      address,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [ address ],
      blockNumber
    })
    return await rpcs.next(chainId, blockNumber).readContract({
      address,
      abi: parseAbi(['function convertToAssets(uint256) view returns (uint256)']),
      functionName: 'convertToAssets',
      args: [ shares ],
      blockNumber
    })
  } catch(error) {
    console.warn('🚨', 'extractLockedProfit__v3', 'readContract fail', chainId, address, blockNumber)
    console.warn(error)
    return undefined
  }
}
