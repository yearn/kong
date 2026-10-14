export const AGGREGATE_TVL_KEY = 'rest:tvl:aggregate'
export const AGGREGATE_TVL_SUMMARY_KEY = 'rest:tvl:summary'

export type AggregateTvlSummary = {
  updatedAt: string
  chains: { chainId: number, tvl: number }[]
}
