import { SnapshotSchema, Thing } from 'lib/types'
import { Float } from './helpers/bignumber-float'
import { calculateMonthlyAPY, calculateWeeklyAPY, calculateYearlyAPY, fetchPPSLastMonth, fetchPPSLastWeek, fetchPPSToday } from './helpers/pps'
import { first } from '../db'

export async function computeV2ForwardAPY(vault: Thing): Promise<{
  type: string,
  netAPY: number,
  fees: {
    performance: number,
    management: number,
  },
  points: {
    weekAgo: number,
    monthAgo: number,
    inception: number,
  },
  pricePerShare: {
    today: number,
    weekAgo: number,
    monthAgo: number,
  }
}> {

  const ppsInception = new Float(1)
  const ppsToday = await fetchPPSToday({
    chainId: vault.chainId,
    vaultAddress: vault.address,
    decimals: vault.defaults.decimals
  })
  const ppsWeekAgo = await fetchPPSLastWeek(vault.chainId, vault.address)
  const ppsMonthAgo = await fetchPPSLastMonth(vault.chainId, vault.address)

  const snapshot = await first(SnapshotSchema, `
    SELECT * FROM snapshot
    WHERE chain_id = $1
    AND address = $2
  `, [vault.chainId, vault.address])

  const performanceFee = snapshot.snapshot.performanceFee
  const managementFee = snapshot.snapshot.managementFee
  const vaultAPRType = 'v2:averaged'

  const vaultAPR = {
    type:   vaultAPRType,
    netAPY: calculateMonthlyAPY(ppsToday, ppsMonthAgo).toFloat64()[0],
    fees: {
      performance: performanceFee,
      management:  managementFee,
    },
    points: {
      weekAgo:   calculateWeeklyAPY(ppsToday, ppsWeekAgo).toFloat64()[0],
      monthAgo:  calculateMonthlyAPY(ppsToday, ppsMonthAgo).toFloat64()[0],
      inception: calculateYearlyAPY(ppsToday, ppsInception).toFloat64()[0],
    },
    pricePerShare: {
      today:    ppsToday.toFloat64()[0],
      weekAgo:  ppsWeekAgo.toFloat64()[0],
      monthAgo: ppsMonthAgo.toFloat64()[0],
    },
  }

  return vaultAPR
}
