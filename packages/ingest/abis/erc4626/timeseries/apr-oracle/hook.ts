import { Output, OutputSchema } from 'lib/types'
import { Data } from '../../../../extract/timeseries'
import { resolveOracleApr } from '../../../yearn/3/vault/timeseries/apr-oracle/hook'

export const outputLabel = 'apr-oracle'

// Plain erc4626 vaults (e.g. Yearn-branded Morpho vaults) aren't classified as
// yearn/3/vault, so they never ran the apr oracle. The oracle prices them by
// address all the same. Net apr/apy aren't surfaced for erc4626 vaults, so only
// emit apr/apy.
export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const resolved = await resolveOracleApr(chainId, address, data)
  if (!resolved) return []

  const output = (component: string, value: number): Output => ({
    label: outputLabel, component, value, chainId, address, blockNumber: resolved.blockNumber, blockTime: data.blockTime,
  })

  return OutputSchema.array().parse([
    output('apr', resolved.apr),
    output('apy', resolved.apy),
    output(`source:${resolved.source}`, 1),
  ])
}
