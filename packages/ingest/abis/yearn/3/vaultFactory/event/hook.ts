import { z } from 'zod'
import { mq } from 'lib'
import { parseAbi, toEventSelector } from 'viem'
import { rpcs } from 'lib/rpcs'
import { estimateCreationBlock } from 'lib/blocks'
import { ThingSchema, zhexstring } from 'lib/types'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../lib'

export const topics = [
  'event NewVault(address indexed vault_address, address indexed asset)'
].map(e => toEventSelector(e))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { vault_address: vault, asset } = z.object({
    vault_address: zhexstring,
    asset: zhexstring
  }).parse(data.args)

  const erc20 = await fetchOrExtractErc20(chainId, asset)
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId, address: asset, label: 'erc20',
    defaults: erc20
  }))

  const multicall = await rpcs.next(chainId).multicall({ contracts: [
    {
      address: vault, functionName: 'apiVersion',
      abi: parseAbi(['function apiVersion() view returns (string)'])
    }
  ]})

  throwOnMulticallError(multicall)

  const [apiVersion] = multicall
  const { number: inceptBlock, timestamp: inceptTime } = await estimateCreationBlock(chainId, vault)

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: vault,
    label: 'vault',
    defaults: {
      erc4626: true,
      v3: true,
      vaultType: '1',
      asset: erc20.address,
      decimals: erc20.decimals,
      apiVersion: apiVersion!.result!,
      factory: address,
      inceptBlock,
      inceptTime
    }
  }))
}
