import { Data } from '../../../../extract/timeseries'
import { Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { first } from '../../../../db'
import { estimateHeight, getBlock } from 'lib/blocks'
import { math, multicall3 } from 'lib'
import { ReadContractParameters } from 'viem'
import { mainnet } from 'viem/chains'
import { rpcs } from '../../../../rpcs'
import abi from '../../abi'
import { APYSchema } from '../../../yearn/lib/apy'

export const outputLabel = 'apy-bwd-delta-pps'

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
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
    [chainId, address, 'vault']
  )

  if (!vault) return []

  const apy = await _compute(vault, blockNumber)
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

export async function _compute(vault: Thing, blockNumber: bigint) {
  if (!vault.defaults.inceptBlock) return undefined
  const { chainId, address } = vault
  const block = await getBlock(chainId, blockNumber)

  const result = APYSchema.parse({
    chainId,
    address,
    weeklyNet: undefined,
    weeklyPricePerShare: undefined,
    weeklyBlockNumber: 0n,
    monthlyNet: undefined,
    monthlyPricePerShare: undefined,
    monthlyBlockNumber: 0n,
    inceptionNet: 0,
    inceptionPricePerShare: 0n,
    inceptionBlockNumber: vault.defaults.inceptBlock,
    net: 0,
    grossApr: 0,
    pricePerShare: 0n,
    blockNumber: block.number,
    blockTime: block.timestamp,
  })

  const ppsParameters = {
    abi, address, functionName: 'convertToAssets',
    args: [10n ** BigInt(vault.defaults.decimals ?? 0n)]
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

  const netApr = result.net > 0
    ? annualCompoundingPeriods * Math.pow(result.net + 1, 1 / annualCompoundingPeriods) - annualCompoundingPeriods
    : 0

  result.grossApr = netApr

  return result
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
