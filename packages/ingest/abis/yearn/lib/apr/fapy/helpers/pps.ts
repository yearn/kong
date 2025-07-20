import { rpcs } from 'lib/rpcs'
import { Float } from './bignumber-float'
import { BigNumberInt, toNormalizedAmount } from './bignumber-int'
import { yearnVaultMetadataAbi } from '../abis/yearn-vault-metadata.abi'
import { query } from '../../../../../db'
import { z } from 'zod'


export async function fetchPPSToday({
  chainId,
  vaultAddress,
  decimals
}: {
  chainId: number
  vaultAddress: string
  decimals: number
}) {
  try {
    const pps = await rpcs.next(chainId).readContract({
      address: vaultAddress as `0x${string}`,
      abi: yearnVaultMetadataAbi,
      functionName: 'pricePerShare',
      args: []
    }) as bigint

    return toNormalizedAmount(new BigNumberInt(pps), decimals)
  } catch (error) {
    console.error('Error fetching PPS:', error)
    return new Float(0)
  }
}


async function getPPSByPeriod(vaultAddress: string, period: number, unit: 'days' | 'weeks' | 'months' | 'years') {
  const request = await query(z.any(), `
    SELECT AVG(value) as value
    FROM "output"
    WHERE label = 'pps'
      AND series_time >= NOW() - INTERVAL '${period} ${unit}'
      AND address = $1
  `, [vaultAddress])

  return new Float(request[0].value)
}

export async function fetchPPSLastWeek(vaultAddress: string) {
  return getPPSByPeriod(vaultAddress, 7, 'days')
}

export async function fetchPPSLastMonth(vaultAddress: string) {
  return getPPSByPeriod(vaultAddress, 30, 'days')
}

export function calculateAPY(currentPPS: Float, historicalPPS: Float, days: number) {
  if(historicalPPS.eq(new Float(0)) || currentPPS.eq(historicalPPS)) {
    return new Float(0)
  }

  const ppsChange = new Float(0).sub(currentPPS, historicalPPS)
  const percentageChange = new Float().div(ppsChange, historicalPPS)
  const daysFloat = new Float().setInt(BigNumberInt.from(days))
  const annualizedChange = new Float().div(percentageChange, daysFloat)

  const apy = new Float().mul(annualizedChange, new Float(365))
  return apy
}

export function calculateWeeklyAPY(currentPPS: Float, weekAgoPPS: Float) {
  return calculateAPY(currentPPS, weekAgoPPS, 7)
}

/**************************************************************************************************
** CalculateMonthlyAPY calculates the annualized APY based on the price per share change over
** the past 30 days.
**
** @param currentPPS The current price per share value
** @param monthAgoPPS The price per share value from 30 days ago
** @return *bigNumber.Float The calculated monthly APY as a decimal
**************************************************************************************************/
export function calculateMonthlyAPY(currentPPS: Float, monthAgoPPS: Float) {
  return calculateAPY(currentPPS, monthAgoPPS, 30)
}

/**************************************************************************************************
** CalculateYearlyAPY calculates the annualized APY based on the price per share change over
** the past 365 days.
**
** @param currentPPS The current price per share value
** @param yearlyPPS The price per share value from 365 days ago
** @return *bigNumber.Float The calculated yearly APY as a decimal
**************************************************************************************************/
export function calculateYearlyAPY(currentPPS: Float, yearlyPPS: Float) {
  return calculateAPY(currentPPS, yearlyPPS, 365)
}
