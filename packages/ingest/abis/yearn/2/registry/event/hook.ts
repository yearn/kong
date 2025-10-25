import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema, zhexstring } from 'lib/types'
import { fetchOrExtractErc20 } from '../../../lib'

export const topics = [
  'event NewVault(address indexed token, uint256 indexed deployment_id, address vault, string api_version)',
  'event NewExperimentalVault(address indexed token, address indexed deployer, address vault, string api_version)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { vault, token, api_version } = z.object({
    vault: zhexstring,
    token: zhexstring,
    api_version: z.string()
  }).parse(data.args)

  const erc20 = await fetchOrExtractErc20(chainId, token)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: token, label: 'erc20',
    defaults: erc20
  }))

  const block = await estimateCreationBlock(chainId, vault)
  const inceptBlock = block.number
  const inceptTime = block.timestamp
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: vault,
    label: 'vault',
    defaults: {
      yearn: true,
      origin: 'yearn',
      apiVersion: api_version,
      registry: address,
      asset: erc20.address,
      decimals: erc20.decimals,
      inceptBlock,
      inceptTime
    }
  }))
}
