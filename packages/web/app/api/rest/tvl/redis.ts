export const AGGREGATE_TVL_KEY = 'rest:tvl:aggregate'
export const AGGREGATE_TVL_SUMMARY_KEY = 'rest:tvl:summary'

export type AggregateTvlSummary = {
  updatedAt: string
  unpricedVaults?: number
  chains: { chainId: number, tvl: number, unpricedVaults?: number }[]
}
