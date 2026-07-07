import { Output, OutputSchema } from 'lib/types'
import { Data } from '../../../../extract/timeseries'
import { computeApy } from '../../../yearn/lib/apy'
import { readCurrentApr, resolveOracleApr } from '../../../yearn/3/vault/timeseries/apr-oracle/hook'

export const outputLabel = 'apr-oracle'

// Plain erc4626 vaults (e.g. Yearn-branded Morpho vaults) aren't classified as
// yearn/3/vault, so they never ran the apr oracle. The oracle prices them by
// address all the same. netApr/netApy stay v3-only (they need the v3 fee path),
// but currentApr/currentApy only need the oracle read, so surface them here too.
export default async function (
  chainId: number,
  address: `0x${string}`,
  data: Data,
): Promise<Output[]> {
  const resolved = await resolveOracleApr(chainId, address, data)
  if (!resolved) return []

  const currentApr = resolved.currentApr !== undefined
    ? resolved.currentApr
    : await readCurrentApr(chainId, address, resolved.blockNumber, resolved.oracleAddress)

  const output = (component: string, value: number): Output => ({
    label: outputLabel, component, value, chainId, address, blockNumber: resolved.blockNumber, blockTime: data.blockTime,
  })

  const outputs = [output('apr', resolved.apr), output('apy', resolved.apy)]
  if (currentApr !== undefined) {
    outputs.push(output('currentApr', currentApr), output('currentApy', computeApy(currentApr)))
  }

  return OutputSchema.array().parse(outputs)
}
