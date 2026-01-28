import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector, parseAbi } from 'viem'
import { rpcs } from 'lib/rpcs'
import { ThingSchema, zhexstring } from 'lib/types'

export const topics = [
  'event Register(address indexed gauge, uint256 idx)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { gauge } = z.object({
    gauge: zhexstring
  }).parse(data.args)

  // Query the gauge contract to get the asset (vault address)
  // VeYFI gauges are ERC4626 vaults, so they use asset() not stakingToken()
  const stakingToken = await rpcs.next(chainId).readContract({
    address: gauge,
    functionName: 'asset',
    abi: parseAbi(['function asset() view returns (address)'])
  })

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: gauge,
    label: 'stakingPool',
    defaults: {
      vault: stakingToken,
      source: 'VeYFI',
      inceptBlock: data.blockNumber,
      inceptTime: data.blockTime
    }
  }))
}
