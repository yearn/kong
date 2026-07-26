// One key per controller, plus a collection key per chain. A controller is
// asset-class-bound by construction — its ASSET and VAULT are constructor args
// with no setters — so a chain holds one controller per asset class (USD, BTC,
// ETH, ...), not one controller.
export function getTrancheControllersKey(chainId: number): string {
  return `rest:tranche:${chainId}:controllers`
}

export function getTrancheSystemKey(chainId: number, controller: string): string {
  return `rest:tranche:${chainId}:${controller.toLowerCase()}`
}
