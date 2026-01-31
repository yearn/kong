import { EvmAddressSchema, ThingSchema } from 'lib/types'
import { z } from 'zod'
import { fetchOrExtractErc20 } from '../../yearn/lib'
import { mq } from 'lib'
import { getSparkline } from '../../../db'
import { getLatestApy, getLatestOracleApr } from '../../../helpers/apy-apr'

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { asset } = z.object({ asset: EvmAddressSchema }).parse(data)

  const sparklines = {
    tvl: await getSparkline(chainId, address, 'tvl-c', 'tvl'),
    apy: await getSparkline(chainId, address, 'apy-bwd-delta-pps', 'net'),
    pps: await getSparkline(chainId, address, 'pps', 'raw')
  }

  const oracle = await getLatestOracleApr(chainId, address)
  const historical = await getLatestApy(chainId, address)

  const erc20 = await fetchOrExtractErc20(chainId, asset)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: asset, label: 'erc20', defaults: erc20
  }))

  return {
    asset: erc20,
    sparklines,
    tvl: sparklines.tvl[0],
    apy: historical,
    performance: {
      estimated: undefined,
      oracle: (oracle[0] || oracle[1]) ? {
        apr: oracle[0],
        apy: oracle[1]
      } : undefined,
      historical: historical ? {
        net: historical.net,
        weeklyNet: historical.weeklyNet,
        monthlyNet: historical.monthlyNet,
        inceptionNet: historical.inceptionNet
      } : undefined
    },
    pricePerShare: sparklines.pps[0]?.close ?? undefined
  }
}
