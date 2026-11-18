import { ReadContractParameters } from 'viem'
import { cache } from 'lib/cache'
import { cachePps } from '../../pps-cache'
import { rpcs } from '../../rpcs'
import abi from './abi'

const SHARE_DECIMALS_TTL = 24 * 60 * 60 * 1000

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
  const key = `erc4626:shareDecimals:${chainId}:${address.toLowerCase()}`
  const shareDecimals = await cache.wrap(key, async () => {
    const decimals = await rpcs.next(chainId).readContract({
      abi, address, functionName: 'decimals'
    }) as bigint
    // Redis stores JSON values, so keep the successful bigint as a string. The
    // cache callback deliberately has no fallback: rejected reads are not
    // cached and can recover on the next attempt.
    return String(decimals)
  }, SHARE_DECIMALS_TTL).then(value => BigInt(value)).catch(error => {
    console.warn('🚨', 'erc4626 decimals() read failed, falling back to stored decimals', chainId, address, error)
    return BigInt(fallbackDecimals ?? 0)
  })

  return {
    abi, address, functionName: 'convertToAssets', args: [10n ** shareDecimals]
  } as ReadContractParameters
}

// Use the vault's actual share scale as both the quote input and part of the
// cache identity. Asset decimals from defaults are not interchangeable with
// ERC-4626 share decimals.
export async function readPpsAtBlock(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  fallbackDecimals?: number,
  options: { blockTime?: bigint, isHistorical?: boolean } = {}
): Promise<bigint> {
  const parameters = await ppsReadParameters(chainId, address, fallbackDecimals)
  return await readPpsWithParameters(chainId, address, blockNumber, parameters, options)
}

export async function readPpsWithParameters(
  chainId: number,
  address: `0x${string}`,
  blockNumber: bigint,
  parameters: ReadContractParameters,
  options: { blockTime?: bigint, isHistorical?: boolean } = {}
): Promise<bigint> {
  const shareScale = BigInt((parameters.args as readonly bigint[])[0])

  return await cachePps(chainId, address, blockNumber, `erc4626:convertToAssets:${shareScale}`, async () => {
    return await rpcs.next(chainId, blockNumber).readContract({
      ...parameters,
      blockNumber
    }) as bigint
  }, options)
}
