import { ReadContractParameters } from 'viem'
import { rpcs } from '../../rpcs'
import abi from './abi'

// pps must be quoted in share units (the vault's own decimals()), not the asset
// decimals stored in thing.defaults — they differ for vaults like the 18-share /
// 6-asset Yearn Morpho vaults, where using asset decimals rounds convertToAssets
// to 0. decimals() is immutable, so read it at latest (avoids archive-node
// dependency). On a read failure we warn and fall back to the stored decimals,
// but that fallback is only correct when shares == asset, so it must be loud.
export async function ppsReadParameters(
  chainId: number,
  address: `0x${string}`,
  fallbackDecimals?: number,
): Promise<ReadContractParameters> {
  const shareDecimals = await rpcs.next(chainId).readContract({
    abi, address, functionName: 'decimals'
  }).then(d => d as bigint).catch(error => {
    console.warn('🚨', 'erc4626 decimals() read failed, falling back to stored decimals', chainId, address, error)
    return BigInt(fallbackDecimals ?? 0)
  })

  return {
    abi, address, functionName: 'convertToAssets', args: [10n ** shareDecimals]
  } as ReadContractParameters
}
