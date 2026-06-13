import { Output } from 'lib/types'
import { Data } from '../../../../extract/timeseries'
import _process from '../../../yearn/lib/tvl'

export const outputLabel = 'tvl'

export default async function process(chainId: number, address: `0x${string}`, data: Data): Promise<Output[]> {
  return _process(chainId, address, data)
}
