export interface LatestBlock {
  chainId: number
  blockNumber: string
  blockTimestamp: string
  queueTimestamp: string
}

export interface Price {
  chainId: number
  tokenAddress: string
  symbol: string
  priceUsd: number
  asOfBlockNumber: string
  asOfTime: string
}

export interface Vault {
  chainId: number
  address: `0x${string}`
  type?: 'vault' | 'strategy'
  apiVersion?: string
  apetaxType?: string
  apetaxStatus?: string
  registryStatus?: string
  registryAddress?: `0x${string}`
  symbol?: string,
  name?: string,
  decimals?: number,
  assetAddress?: `0x${string}`
  assetName?: string,
  assetSymbol?: string,
  totalAssets?: string,
  activationTimestamp?: string,
  activationBlockNumber?: string,
  asOfBlockNumber: string
}

export interface Strategy {
  chainId: number
  address: `0x${string}`
  apiVersion: string
  name?: string,
  vaultAddress?: string,
  withdrawalQueueIndex?: number,
  migrateAddress?: string,
  activationTimestamp?: string,
  activationBlockNumber?: string,
  asOfBlockNumber: string
}

export interface WithdrawalQueueItem {
  chainId: number
  vaultAddress: `0x${string}`
  queueIndex: number
  strategyAddress?: `0x${string}`
  asOfBlockNumber: string
}
