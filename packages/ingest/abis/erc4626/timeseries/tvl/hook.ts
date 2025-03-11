import { z } from 'zod'
import { Data } from '../../../../extract/timeseries'
import { EvmAddressSchema, Output, OutputSchema, Thing, ThingSchema } from 'lib/types'
import { priced } from 'lib/math'
import { estimateHeight, getBlock } from 'lib/blocks'
import { first } from '../../../../db'
import { fetchErc20PriceUsd } from '../../../../prices'
import { rpcs } from '../../../../rpcs'
import abi from '../../abi'

export const outputLabel = 'tvl'

export default async function _process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  let blockNumber: bigint = 0n
  let latest: boolean = false
  if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
    latest = true;
    ({ number: blockNumber } = await getBlock(chainId))
  } else {
    const estimate = await estimateHeight(chainId, data.blockTime);
    ({ number: blockNumber } = await getBlock(chainId, estimate))
  }

  const vault = await first<Thing>(ThingSchema,
    'SELECT * FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
    [chainId, address, 'vault']
  )

  if (!vault) return []

  const { tvl, source: priceSource } = await _compute(vault, blockNumber, latest)

  return OutputSchema.array().parse([{
    chainId, address, blockNumber, blockTime: data.blockTime, label: data.outputLabel,
    component: priceSource, value: tvl
  }])
}

export async function _compute(vault: Thing, blockNumber: bigint, latest = false) {
  const { chainId, address, defaults } = vault
  const { asset, decimals } = z.object({
    asset: EvmAddressSchema,
    decimals: z.number({ coerce: true }) }
  ).parse(defaults)

  const { priceUsd, priceSource: source } = await fetchErc20PriceUsd(chainId, asset, blockNumber, latest)
  const normalizedPrice = priceUsd === null ? 0 : priceUsd

  const totalAssets = await rpcs.next(chainId, blockNumber).readContract({
    abi, address, functionName: 'totalAssets', blockNumber
  }) as bigint

  if(totalAssets === 0n) return { priceUsd, source, tvl: 0 }

  const tvl = priced(totalAssets, decimals, normalizedPrice)

  return { priceUsd: normalizedPrice, source, tvl }
}
