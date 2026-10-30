import { mq } from 'lib'
import { EvmAddressSchema, ThingSchema } from 'lib/types'
import { z } from 'zod'
import { getSparkline } from '../../../db'
import { getLatestApy, getLatestOracleApr } from '../../../helpers/apy-apr'
import { fetchOrExtractErc20 } from '../../yearn/lib'
import { snapshotTvl } from '../../yearn/lib/tvl'

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { asset, totalAssets, blockTime } = z.object({
    asset: EvmAddressSchema, totalAssets: z.bigint().optional(), blockTime: z.bigint().optional()
  }).parse(data)

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
    tvl: await snapshotTvl(chainId, address, asset, erc20.decimals, totalAssets, blockTime, sparklines.tvl[0]),
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
