import { SnapshotSchema, Thing } from 'lib/types'
import { Float } from './helpers/bignumber-float'
import { calculateMonthlyAPY, calculateWeeklyAPY, calculateYearlyAPY, fetchPPSLastMonth, fetchPPSLastWeek, fetchPPSToday } from './helpers/pps'
import { first } from '../db'

export async function computeV2ForwardAPY(vault: Thing) {

  const ppsInception = new Float(1)
  const ppsToday = await fetchPPSToday({
    chainId: vault.chainId,
    vaultAddress: vault.address,
    decimals: vault.defaults.decimals
  })
  const ppsWeekAgo = await fetchPPSLastWeek(vault.chainId, vault.address)
  const ppsMonthAgo = await fetchPPSLastMonth(vault.chainId, vault.address)

  const snapshot = await first(SnapshotSchema, `
    SELECT * FROM snapshots
    WHERE chainId = ${vault.chainId}
    AND address = ${vault.address}
  `, [vault.chainId, vault.address])

  const performanceFee = snapshot.snapshot.hooks.fees.performanceFee
  const managementFee = snapshot.snapshot.hooks.fees.managementFee
  const vaultAPRType = 'v2:averaged'

  const vaultAPR = {
    Type:   vaultAPRType,
    NetAPY: calculateMonthlyAPY(ppsToday, ppsMonthAgo),
    Fees: {
      Performance: performanceFee,
      Management:  managementFee,
    },
    Points: {
      WeekAgo:   calculateWeeklyAPY(ppsToday, ppsWeekAgo),
      MonthAgo:  calculateMonthlyAPY(ppsToday, ppsMonthAgo),
      Inception: calculateYearlyAPY(ppsToday, ppsInception),
    },
    PricePerShare: {
      Today:    ppsToday,
      WeekAgo:  ppsWeekAgo,
      MonthAgo: ppsMonthAgo,
    },
  }

  return vaultAPR
}
