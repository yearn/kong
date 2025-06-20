import { z } from 'zod'
import { toEventSelector } from 'viem'
import { EvmAddressSchema, ThingSchema } from 'lib/types'
import { fetchOrExtractErc20 } from '../../../lib'
import { mq } from 'lib'

export const topics = [
  'event VestingEscrowCreated(address indexed funder, address indexed token, address indexed recipient, address escrow, uint256 amount, uint256 vesting_start, uint256 vesting_duration, uint256 cliff_length, bool open_claim)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { args } = z.object({
    args: z.object({
      funder: EvmAddressSchema,
      token: EvmAddressSchema,
      recipient: EvmAddressSchema,
      escrow: EvmAddressSchema,
      amount: z.bigint({ coerce: true }),
      vesting_start: z.bigint({ coerce: true }),
      vesting_duration: z.bigint({ coerce: true }),
      cliff_length: z.bigint({ coerce: true }),
      open_claim: z.boolean()
    })
  }).parse(data)

  const erc20 = await fetchOrExtractErc20(chainId, args.token)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: args.token, label: 'erc20',
    defaults: erc20
  }))

  return {
    ...args,
    token: erc20
  }
}
