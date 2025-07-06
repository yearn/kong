import { Thing } from 'lib/types'
import { calculateMonthlyAPY, fetchPPSLastMonth, fetchPPSToday } from './helpers/pps'
import { VaultAPY } from '.'

export async function computeV2ForwardAPY(vault: Thing): Promise<VaultAPY> {

  const ppsToday = await fetchPPSToday({
    chainId: vault.chainId,
    vaultAddress: vault.address,
    decimals: vault.defaults.decimals
  })
  const ppsMonthAgo = await fetchPPSLastMonth(vault.chainId, vault.address)

  const vaultAPR = {
    type:   'v2:averaged',
    netAPY: calculateMonthlyAPY(ppsToday, ppsMonthAgo).toFloat64()[0],
  }

  return vaultAPR
}
