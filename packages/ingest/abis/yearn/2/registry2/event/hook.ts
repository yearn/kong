import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema, zhexstring } from 'lib/types'
import { fetchOrExtractErc20 } from '../../../lib'

export const topics = [
  'event NewVault(address indexed token, uint256 indexed vaultId, uint256 vaultType, address vault, string apiVersion)'
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const { vault, token, apiVersion } = z.object({
    vault: zhexstring,
    token: zhexstring,
    apiVersion: z.string()
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
      apiVersion,
      registry: address,
      asset: erc20.address,
      decimals: erc20.decimals,
      inceptBlock,
      inceptTime
    }
  }))
}
