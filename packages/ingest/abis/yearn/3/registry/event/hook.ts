import { z } from 'zod'
import { mq } from 'lib'
import { parseAbi, toEventSelector } from 'viem'
import { rpcs } from 'lib/rpcs'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema, zhexstring } from 'lib/types'
import { fetchOrExtractErc20 } from '../../../lib'

export const topics = [
  'event NewEndorsedVault(address indexed vault, address indexed asset, uint256 releaseVersion, uint256 vaultType)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { vault, asset, vaultType } = z.object({
    vault: zhexstring,
    asset: zhexstring,
    vaultType: z.bigint({ coerce: true }).optional()
  }).parse(data.args)

  const erc20 = await fetchOrExtractErc20(chainId, asset)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: asset, label: 'erc20',
    defaults: erc20
  }))

  const apiVersion = await rpcs.next(chainId).readContract({
    address: vault, functionName: 'apiVersion',
    abi: parseAbi(['function apiVersion() view returns (string)'])
  })

  const { number: inceptBlock, timestamp: inceptTime } = await estimateCreationBlock(chainId, vault)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: vault,
    label: 'vault',
    defaults: {
      erc4626: true,
      v3: true,
      yearn: true,
      asset: erc20.address,
      decimals: erc20.decimals,
      apiVersion,
      vaultType,
      registry: address,
      inceptBlock,
      inceptTime
    }
  }))

  if (vaultType === 2n) {
    await mq.add(mq.job.load.thing, ThingSchema.parse({
      chainId,
      address: vault,
      label: 'strategy',
      defaults: {
        erc4626: true,
        v3: true,
        yearn: true,
        asset: erc20.address,
        decimals: erc20.decimals,
        apiVersion,
        registry: address,
        inceptBlock,
        inceptTime
      }
    }))
  }
}
