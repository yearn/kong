import { z } from 'zod'
import { toEventSelector } from 'viem'
import { priced } from 'lib/math'
import { fetchOrExtractDecimals } from '../../lib'
import { fetchErc20PriceUsd } from '../../../../prices'

export const topics = [
  'event Transfer(address indexed sender, address indexed receiver, uint256 value)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { blockNumber, args } = z.object({
    blockNumber: z.bigint({ coerce: true }),
    args: z.object({
      value: z.bigint({ coerce: true })
    })
  }).parse(data)

  const decimals = await fetchOrExtractDecimals(chainId, address)
  const price = await fetchErc20PriceUsd(chainId, address, blockNumber)
  return {
    valueUsd: priced(args.value, decimals, price.priceUsd),
    priceUsd: price.priceUsd,
    priceSource: price.priceSource
  }
}
