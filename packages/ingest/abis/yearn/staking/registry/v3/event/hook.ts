import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { ThingSchema, zhexstring } from 'lib/types'

export const topics = [
  'event StakingPoolAdded(address indexed token, address stakingPool)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { token, stakingPool } = z.object({
    token: zhexstring,
    stakingPool: zhexstring
  }).parse(data.args)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: stakingPool,
    label: 'stakingPool',
    defaults: {
      vault: token,
      source: 'V3 Staking',
      inceptBlock: data.blockNumber,
      inceptTime: data.blockTime
    }
  }))
}
