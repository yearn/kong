import { multicall3 } from 'lib'
import { estimateHeight, getBlock } from 'lib/blocks'
import { div, normalize } from 'lib/math'
import { EvmAddressSchema, Output, OutputSchema } from 'lib/types'
import { rpcs } from '../../../../../../../rpcs'
import { Data } from '../../../../../../../extract/timeseries'
import { fetchOrExtractDecimals } from '../../../../../lib'
import abi from '../../abi'

export const outputLabel = 'tranche-system'

// System-wide backing over time, read at the controller. `totalClaims` is what
// the tranches collectively claim; `backingAssets` is what actually stands
// behind those claims (main vault assets plus reserve). Their ratio is the
// solvency measure — accounting coverage, which is distinct from what can be
// withdrawn right now.
export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  console.info('🧮', data.outputLabel, chainId, address, (new Date(Number(data.blockTime) * 1000)).toDateString())

  let blockNumber: bigint = 0n
  if(data.blockTime >= BigInt(Math.floor(new Date().getTime() / 1000))) {
    blockNumber = (await getBlock(chainId)).number
  } else {
    blockNumber = await estimateHeight(chainId, data.blockTime)
  }

  if(!multicall3.supportsBlock(chainId, blockNumber)) {
    console.warn('🚨', 'block not supported', chainId, blockNumber)
    return []
  }

  const multicall = await rpcs.next(chainId, blockNumber).multicall({
    contracts: [
      { address, abi, functionName: 'ASSET' },
      { address, abi, functionName: 'totalClaims' },
      { address, abi, functionName: 'vaultAssets' },
      { address, abi, functionName: 'reserveAssets' },
      { address, abi, functionName: 'backingAssets' }
    ],
    blockNumber,
    allowFailure: true
  })

  if (multicall.some(result => result.status !== 'success')) {
    console.warn('🚨', outputLabel, 'multicall fail', chainId, address, blockNumber)
    return []
  }

  const [asset, totalClaims, vaultAssets, reserveAssets, backingAssets] = multicall
  const decimals = Number(await fetchOrExtractDecimals(chainId, EvmAddressSchema.parse(asset.result)))

  const claims = totalClaims.result as bigint
  const backing = backingAssets.result as bigint

  const components: { component: string, value: number | undefined }[] = [
    { component: 'totalClaims', value: normalize(claims, decimals) },
    { component: 'vaultAssets', value: normalize(vaultAssets.result as bigint, decimals) },
    { component: 'reserveAssets', value: normalize(reserveAssets.result as bigint, decimals) },
    { component: 'backingAssets', value: normalize(backing, decimals) },
    { component: 'coverageRatio', value: claims > 0n ? div(backing, claims) : undefined }
  ]

  const block = await getBlock(chainId, blockNumber)

  return OutputSchema.array().parse(components.map(({ component, value }) => ({
    chainId, address, label: data.outputLabel, component, value,
    blockNumber: block.number, blockTime: block.timestamp
  })))
}
