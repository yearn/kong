import { toEventSelector } from 'viem'
import { z } from 'zod'
import { EvmAddressSchema } from 'lib/types'
import { discoverAllocator } from '../../../lib/allocator-discovery'

export const topics = [toEventSelector('event NewDebtAllocator(address indexed allocator, address indexed governance)')]

export default async function process(chainId: number, _address: `0x${string}`, data: object) {
  const { args } = z.object({ args: z.object({ allocator: EvmAddressSchema, governance: EvmAddressSchema }) }).parse(data)
  await discoverAllocator(chainId, args.allocator)
}
