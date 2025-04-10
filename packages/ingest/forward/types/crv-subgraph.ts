export interface CrvSubgraphPool {
    address: string
    latestDailyApy: number
    latestWeeklyApy: number
    rawVolume: number | null
    type: string
    virtualPrice: number
    volumeUSD: number
}