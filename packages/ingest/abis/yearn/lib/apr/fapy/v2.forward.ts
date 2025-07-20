import { Thing } from 'lib/types'
import { Float } from './helpers/bignumber-float'
import { fetchPPSToday, calculateAPY, fetchPPSLastWeek, fetchPPSLastMonth } from './helpers/pps'
import { estimateHeight, getBlock } from 'lib/blocks'

// Types to match the Go struct definitions
export interface TFees {
  performance: Float
  management: Float
}

export interface THistoricalPoints {
  weekAgo: Float
  monthAgo: Float
  inception: Float
}

export interface TPricePerShare {
  today: Float
  weekAgo: Float
  monthAgo: Float
}

export interface TVaultAPY {
  type: string
  netAPY: Float
  fees: TFees
  points: THistoricalPoints
  pricePerShare: TPricePerShare
}

async function getBlockNumberByPeriod(chainId: number, daysAgo: number): Promise<bigint> {
  const now = Math.floor(Date.now() / 1000)
  const timestamp = BigInt(now - (daysAgo * 24 * 60 * 60))

  if (daysAgo === 0) {
    return (await getBlock(chainId)).number
  }

  return estimateHeight(chainId, timestamp)
}

export async function computeCurrentV2VaultAPY(
  vault: Thing & { activation?: bigint, performanceFee?: number, managementFee?: number },
) {
  const chainId = vault.chainId
  const yieldVault = vault.address
  const vaultToken =vault.defaults.asset
  const vaultDecimals = Number(vaultToken.defaults.decimals ?? 18)

  const [estBlockToday, estBlockLastWeek, estBlockLastMonth] = await Promise.all([
    getBlockNumberByPeriod(chainId, 0),
    getBlockNumberByPeriod(chainId, 7),
    getBlockNumberByPeriod(chainId, 30)
  ])

  const vaultActivation = vault.activation || 0n
  const blocksSinceDeployment = estBlockToday - vaultActivation

  // Fetch PPS values
  const ppsToday = await fetchPPSToday({
    chainId,
    vaultAddress: yieldVault as string,
    decimals: vaultDecimals
  })

  const ppsWeekAgo = await fetchPPSLastWeek(yieldVault as string)
  const ppsMonthAgo = await fetchPPSLastMonth(yieldVault as string)
  let weeklyAPY = new Float(0)
  let monthlyAPY = new Float(0)

  const isLessThanAWeekOld = vaultActivation > 0n && estBlockLastWeek < vaultActivation
  const isLessThanAMonthOld = vaultActivation > 0n && estBlockLastMonth < vaultActivation

  // Switch logic to handle vaults of different ages
  if (isLessThanAWeekOld) {
    // Calculate average blocks per day over the last 7 days
    const numBlocksIn7Days = Number(estBlockToday - estBlockLastWeek)
    const numBlocksPerDay = numBlocksIn7Days / 7
    let daysSinceDeployment = Number(blocksSinceDeployment) / numBlocksPerDay

    if (daysSinceDeployment < 1) {
      daysSinceDeployment = 1
    }

    weeklyAPY = calculateAPY(ppsToday, ppsWeekAgo, Math.floor(daysSinceDeployment))
    monthlyAPY = weeklyAPY
  } else if (isLessThanAMonthOld) {
    weeklyAPY = calculateAPY(ppsToday, ppsWeekAgo, 7)

    // Calculate average blocks per day over the last 30 days
    const numBlocksIn30Days = Number(estBlockToday - estBlockLastMonth)
    const numBlocksPerDay = numBlocksIn30Days / 30
    let daysSinceDeployment = Number(blocksSinceDeployment) / numBlocksPerDay

    if (daysSinceDeployment < 1) {
      daysSinceDeployment = 1
    }

    monthlyAPY = calculateAPY(ppsToday, ppsMonthAgo, Math.floor(daysSinceDeployment))
  } else {
    monthlyAPY = calculateAPY(ppsToday, ppsMonthAgo, 30)
  }


  return {
    netAPY: monthlyAPY.toFloat64()[0],
  }
}
