import { Data } from '../../../../extract/timeseries'
import { Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { first } from '../../../../db'
import { estimateHeightWithAge, getBlock } from 'lib/blocks'
import { math, multicall3 } from 'lib'
import { mainnet } from 'viem/chains'
import { resolveTimeseriesBlock } from '../../../../helpers/timeseries-block'
import { ppsReadParameters, readPpsWithParameters } from '../../lib'
import { APYSchema } from '../../../yearn/lib/apy'

export const outputLabel = 'apy-bwd-delta-pps'

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  const blockNumber = await resolveTimeseriesBlock(chainId, data)
  if (blockNumber === undefined) return []

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

  const inceptionTime = vault.defaults.inceptTime !== undefined
    ? BigInt(vault.defaults.inceptTime)
    : (await getBlock(chainId, result.inceptionBlockNumber)).timestamp
  const ppsParameters = await ppsReadParameters(chainId, address, vault.defaults.decimals)

  const day = 24n * 60n * 60n
  const weeklyTime = block.timestamp - 7n * day
  const monthlyTime = block.timestamp - 30n * day
  const [weeklyEstimate, monthlyEstimate] = await Promise.all([
    estimateHeightWithAge(chainId, weeklyTime),
    estimateHeightWithAge(chainId, monthlyTime)
  ])
  result.weeklyBlockNumber = weeklyEstimate.height
  result.monthlyBlockNumber = monthlyEstimate.height

  result.pricePerShare = await readPpsWithParameters(chainId, address, blockNumber, ppsParameters,
    { blockTime: block.timestamp })
  result.inceptionPricePerShare = await readPpsWithParameters(chainId, address, result.inceptionBlockNumber,
    ppsParameters, { blockTime: inceptionTime })

  if (result.pricePerShare === result.inceptionPricePerShare) return result

  result.weeklyPricePerShare = result.weeklyBlockNumber < result.inceptionBlockNumber ? undefined :
    await readPpsWithParameters(chainId, address, result.weeklyBlockNumber, ppsParameters,
      { isHistorical: weeklyEstimate.historical })
  result.monthlyPricePerShare = result.monthlyBlockNumber < result.inceptionBlockNumber ? undefined :
    await readPpsWithParameters(chainId, address, result.monthlyBlockNumber, ppsParameters,
      { isHistorical: monthlyEstimate.historical })

  result.weeklyNet = result.weeklyPricePerShare === undefined ? undefined : compoundAndAnnualizeDelta(
    { time: weeklyTime, pps: result.weeklyPricePerShare },
    { time: block.timestamp, pps: result.pricePerShare }
  )

  result.monthlyNet = result.monthlyPricePerShare === undefined ? undefined : compoundAndAnnualizeDelta(
    { time: monthlyTime, pps: result.monthlyPricePerShare },
    { time: block.timestamp, pps: result.pricePerShare }
  )

  result.inceptionNet = compoundAndAnnualizeDelta(
    { time: inceptionTime, pps: result.inceptionPricePerShare },
    { time: block.timestamp, pps: result.pricePerShare }
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
  before: { time: bigint, pps: bigint },
  after: { time: bigint, pps: bigint }
) {
  const delta = math.div(after.pps - before.pps, before.pps || 1n)
  const period = Number(after.time - before.time) / 86_400
  return Math.pow(1 + delta, 365.2425 / period) - 1
}
