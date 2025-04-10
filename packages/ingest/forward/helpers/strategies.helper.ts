import { rpcs } from '../../rpcs'
import yearnVaultAbi from '../../abis/yearn/2/vault/abi'

// @TODO: better name ??
export async function getVaultStrategyIndicators(vaultAddress: `0x${string}`, chainId: number, strategyAddress: `0x${string}`) {

  const result = await rpcs.next(chainId).multicall({
    contracts: [
      {
        address: vaultAddress,
        abi: yearnVaultAbi,
        functionName: 'strategies',
        args: [strategyAddress]
      },
      {
        address: vaultAddress,
        abi: yearnVaultAbi,
        functionName: 'managementFee',
      },
    ]
  })

  return {
    ...result[0].result,
    managementFee: result[1].result
  }


}
