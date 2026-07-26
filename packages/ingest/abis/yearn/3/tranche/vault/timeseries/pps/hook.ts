import { Output } from 'lib/types'
import { Data } from '../../../../../../../extract/timeseries'
import _process from '../../../../../2/vault/timeseries/pps/hook'

export const outputLabel = 'pps'

// Same hook as every other yearn vault. The tranche branch lives in the shared
// pps reader (abis/yearn/lib/assets), which prices tranche shares off
// controller-backed assets instead of the tranche's own pricePerShare().
export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, data)
}
