import { Data } from '../../../../../../extract/timeseries'
import { Output } from 'lib/types'
import _process from '../../../../2/vault/timeseries/pps/hook'

export const outputLabel = 'pps'

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, data)
}
