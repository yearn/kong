// PR #494 review: these Ethereum routers are absent from Kong's strategy catalog.
// Their yVault() destinations were verified at block 26,185,670 against Yearn Data.
// Use the relationships only to estimate overlap from the included parent's debt.
// A subsequently collected aggregateTvlTarget (including null) takes precedence.
export const KNOWN_AGGREGATE_TVL_TARGETS = [
  {
    chainId: 1,
    address: '0x36822d0b11F4594380181cE6e76bd4986d46c389',
    target: { chainId: 1, address: '0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE' },
  },
  {
    chainId: 1,
    address: '0x9084B5a98E3b4B257affd82AE4a1753f87906DcE',
    target: { chainId: 1, address: '0x5b8c556b8b2a78696f0b9b830b3d67623122e270' },
  },
]
