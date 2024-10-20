import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { EvmAddressSchema, ThingSchema, zhexstring } from 'lib/types'

export const topics = [
  `event NewProject(bytes32 indexed projectId, address indexed roleManager)`
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { projectId, roleManager } = z.object({
    projectId: zhexstring,
    roleManager: EvmAddressSchema
  }).parse(data.args)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: roleManager, label: 'roleManager',
    defaults: { roleManagerFactory: address, project: { id: projectId } }
  }))
}
