import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { EvmAddressSchema, ThingSchema, zhexstring } from 'lib/types'
import { getBlock } from 'lib/blocks'

export const topics = [
  'event NewProject(bytes32 indexed projectId, address indexed roleManager)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { projectId, roleManager } = z.object({
    projectId: zhexstring,
    roleManager: EvmAddressSchema
  }).parse(data.args)

  const { 
    number: inceptBlock, 
    timestamp: inceptTime 
  } = await getBlock(chainId, data.blockNumber)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: roleManager, label: 'roleManager',
    defaults: { 
      roleManagerFactory: address, 
      project: { id: projectId }, 
      inceptBlock, 
      inceptTime
    }
  }))
}
