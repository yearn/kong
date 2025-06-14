export interface FraxPool {
  type: string
  id: number
  vaultType: string
  vaultVersion: number
  rewardTokenAddresses: string[]
  lockMaxMultiplier: number
  maxLpLockDays: number
  minLpLockDays: number
  stakesUnlocked: boolean
  periodFinish: number
  name: string
  stakingTokenDecimals: number
  stakingTokenSymbol: string
  stakingTokenName: string
  veFXSMultiplier: number
  underlyingTokenAddress: string
  rewardCoins: any[]
  stakingAddress: string
  stakingTokenAddress: string
  rewardsAddress: string
  active: boolean
  farmNeedsSyncing: boolean
  underlyingCoin: any
  stakingTokenUsdPrice: number
  convexPoolData: any
  curvePoolData: any
  rewardAprs: any[]
  isPoolStopped: boolean
  boostedRewardAprs: any[]
  totalRewardAprs: {
    min: string; // but represents float
    max: string; // but represents float
  }
  areConvexPoolsCrvAndCvxBoostable: boolean
  rewardApr?: number
  minBoostedRewardApr?: number
  maxBoostedRewardApr?: number
}
