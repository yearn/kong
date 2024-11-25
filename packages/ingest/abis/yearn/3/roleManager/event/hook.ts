import { z } from 'zod'
import { mq } from 'lib'
import { toEventSelector } from 'viem'
import { EvmAddressSchema, ThingSchema } from 'lib/types'
import { rpcs } from '../../../../../rpcs'
import vaultAbi from '../../vault/abi'
import { getBlock } from 'lib/blocks'

export const topics = [
  `event AddedNewVault(address indexed vault, address indexed debtAllocator, uint256 category)`
].map(e => toEventSelector(e))

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const { 
    number: inceptBlock, 
    timestamp: inceptTime 
  } = await getBlock(chainId, data.blockNumber)

  const { vault, category } = z.object({
    vault: EvmAddressSchema,
    debtAllocator: EvmAddressSchema,
    category: z.bigint({ coerce: true })
  }).parse(data.args)

  const multicall = await rpcs.next(chainId).multicall({ contracts: [
    { address: vault, abi: vaultAbi, functionName: 'asset' },
    { address: vault, abi: vaultAbi, functionName: 'decimals' },
    { address: vault, abi: vaultAbi, functionName: 'apiVersion' }
  ]})

  const [asset, decimals, apiVersion] = multicall

  if (!asset.result || !decimals.result || !apiVersion.result) {
    throw new Error('Vault multicall failed')
  }

  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: vault,
    label: 'vault',
    defaults: {
      erc4626: true,
      v3: true,
      vaultType: '1',
      category,
      asset: asset.result,
      decimals: decimals.result,
      apiVersion: apiVersion.result,
      roleManager: address,
      inceptBlock,
      inceptTime
    }
  }))
}
