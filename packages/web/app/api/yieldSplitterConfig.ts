import { getAddress, type Address } from 'viem'

type TYieldSplitterFactorySource = {
  chainId: number
  address: string
  obsolete?: boolean
}

// Intentional product constraint: only expose metadata for the current live Katana
// yield splitters. On 2026-04-08 we verified the six live splitter contracts
// against all three Katana factories with `isDeployedStrategy(address)`, and each
// resolved only to 0x3E13dB939c03c03852407Ca90D5A59183D28dA62. Older factories did
// emit historical deployments, but those are intentionally excluded from REST and
// GraphQL metadata unless product requirements change.
const YIELD_SPLITTER_FACTORY_SOURCES: TYieldSplitterFactorySource[] = [
  {
    chainId: 747474,
    address: '0x72bd640a903DAE71E1eaA315f31F4dA33C82872d',
    obsolete: true
  },
  {
    chainId: 747474,
    address: '0xfb277c7DfDa414aF824AF08c3596d6c28570347d',
    obsolete: true
  },
  {
    chainId: 747474,
    address: '0x3E13dB939c03c03852407Ca90D5A59183D28dA62'
  }
]

export function getActiveYieldSplitterFactories(
  sources: TYieldSplitterFactorySource[] = YIELD_SPLITTER_FACTORY_SOURCES
): Array<{ chainId: number, address: Address }> {
  return sources
    .filter((source) => !source.obsolete)
    .map((source) => ({
      chainId: source.chainId,
      address: getAddress(source.address)
    }))
}

export const ACTIVE_YIELD_SPLITTER_FACTORIES = getActiveYieldSplitterFactories()
