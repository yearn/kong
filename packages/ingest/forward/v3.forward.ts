
import { estimateHeight } from 'lib/blocks'
import { Float } from './helpers/bignumber-float'
import { BigNumberInt, toNormalizedAmount } from './helpers/bignumber-int'
import { calculateMonthlyAPY, calculateWeeklyAPY, calculateYearlyAPY, fetchPPSLastMonth, fetchPPSLastWeek, fetchPPSToday } from './helpers/pps'
import { SnapshotSchema, StrategyWithIndicators, Thing } from 'lib/types'
import { compare } from 'compare-versions'
import { rpcs } from 'lib/rpcs'
import { v3Oracle } from './abis/oracle-contract.abi'
import { convertFloatAPRToAPY, V3_ORACLE_ADDRESS } from './helpers'
import { first } from '../db'
import { BigNumber } from '@ethersproject/bignumber'

export async function computeCurrentV3VaultAPY(
  vault: Thing
): Promise<{
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
}>{
  const chainID = vault.chainId
  const yieldVault = vault.address

  /**
   * TODO: fetch these from crm
   * const [registry, found] = getVaultFromRegistry(vault.address, chainID)
   * if(found && registry.extraProperties.yieldVaultAddress) {
   *  yieldVault = registry.extraProperties.yieldVaultAddress
   * }
   */
  const ppsInception = new Float(1)
  const ppsToday = await fetchPPSToday({chainId: chainID, vaultAddress: vault.address, decimals: vault.defaults.decimals})
  const ppsWeekAgo = await fetchPPSLastWeek(chainID, yieldVault)
  const ppsMonthAgo = await fetchPPSLastMonth(chainID, yieldVault)

  const vaultSnapshot = await first(SnapshotSchema, `
    SELECT * FROM snapshots
    WHERE chainId = ${chainID}
    AND address = ${vault.address}
  `, [chainID, vault.address])

  const vaultPerformanceFee = toNormalizedAmount(new BigNumberInt(Number(vaultSnapshot.snapshot.performanceFee)), 4)
  const vaultManagementFee = toNormalizedAmount(new BigNumberInt(Number(vaultSnapshot.snapshot.managementFee)), 4)

  const monthAgoTimestamp = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const monthAgoBlockNumber = await estimateHeight(chainID, BigInt(monthAgoTimestamp.getTime() / 1000))
  let vaultAPRType = 'v3:averaged'
  if(compare(vault.defaults.apiVersion, '3', '>=')) {
    vaultAPRType = vaultSnapshot.snapshot.activation && vaultSnapshot.snapshot.activation > monthAgoBlockNumber ? 'v3:new_averaged' : 'v3:averaged'
  }else if(compare(vault.defaults.apiVersion, '3', '<')) {
    vaultAPRType = vaultSnapshot.snapshot.activation && vaultSnapshot.snapshot.activation > monthAgoBlockNumber ? 'v2:new_averaged' : 'v2:averaged'
  }

  const vaultAPR = {
    type: vaultAPRType,
    netAPY: calculateMonthlyAPY(ppsToday, ppsMonthAgo).toFloat64()[0],
    fees: {
      performance: Number(vaultPerformanceFee.toFloat64()[0]),
      management: Number(vaultManagementFee.toFloat64()[0]),
    },
    points: {
      weekAgo: calculateWeeklyAPY(ppsToday, ppsWeekAgo).toFloat64()[0],
      monthAgo: calculateMonthlyAPY(ppsToday, ppsMonthAgo).toFloat64()[0],
      inception: calculateYearlyAPY(ppsToday, ppsInception).toFloat64()[0],
    },
    pricePerShare: {
      today: ppsToday.toFloat64()[0],
      weekAgo: ppsWeekAgo.toFloat64()[0],
      monthAgo: ppsMonthAgo.toFloat64()[0],
    },
  }
  return vaultAPR
}


export async function computeV3ForwardAPY(
  vault: Thing,
  strategies: StrategyWithIndicators[],
  chainId: number,
) {
  const vaultSnapshot = await first(SnapshotSchema, `
    SELECT * FROM snapshots
    WHERE chainId = ${chainId}
    AND address = ${vault.address}
  `, [chainId, vault.address])


  let debtRatioAPR = new Float()
  let oracleAPR = new Float(0)

  if(!vaultSnapshot.snapshot.totalAssets || vaultSnapshot.snapshot.totalAssets === '0') {
    if(strategies.length > 0) {
      for (const strategy of strategies) {
        try {
          const getStrategyAPR = await rpcs.next(chainId).readContract({
            address: V3_ORACLE_ADDRESS[chainId],
            abi: v3Oracle,
            functionName: 'getStrategyApr',
            args: [strategy.address, BigInt(0)],
          })
          oracleAPR = toNormalizedAmount(new BigNumberInt(Number(getStrategyAPR)), 4)
        }catch(err) {
          console.error('getStrategyApr error', err)
          const apr = await rpcs.next(chainId).readContract({
            address: V3_ORACLE_ADDRESS[chainId],
            abi: v3Oracle,
            functionName: 'getCurrentApr',
            args: [strategy.address],
          })
          oracleAPR = toNormalizedAmount(new BigNumberInt(Number(apr)), 4)
        }

        const humanizedAPR = toNormalizedAmount(new BigNumberInt(Number(oracleAPR)), 18)

        const performanceFeeFloat = new Float().setInt(new BigNumberInt(BigNumber.from(strategy.performanceFee).toBigInt()))
        let performanceFee = new Float().div(performanceFeeFloat, new Float(10000))

        performanceFee = new Float().sub(new Float(1), performanceFee)
        const scaledStrategyAPR = new Float().mul(humanizedAPR, performanceFee)

        debtRatioAPR = new Float().add(new Float(0), scaledStrategyAPR)
        debtRatioAPR = new Float().mul(debtRatioAPR, new Float(0.9))

        break
      }
    }
  }else {
    for (const strategy of strategies) {
      if(!strategy.debtRatio || strategy.debtRatio === 0) {
        continue
      }
      try {
        const getStrategyAPR = await rpcs.next(chainId).readContract({
          address: V3_ORACLE_ADDRESS[chainId],
          abi: v3Oracle,
          functionName: 'getStrategyApr',
          args: [strategy.address, BigInt(0)],
        })
        oracleAPR = toNormalizedAmount(new BigNumberInt(Number(getStrategyAPR)), 4)
      }catch(err) {
        console.error('getCurrentApr error', err)
        const apr = await rpcs.next(chainId).readContract({
          address: V3_ORACLE_ADDRESS[chainId],
          abi: v3Oracle,
          functionName: 'getCurrentApr',
          args: [strategy.address],
        })
        oracleAPR = toNormalizedAmount(new BigNumberInt(Number(apr)), 4)
        const humanizedAPR = toNormalizedAmount(new BigNumberInt(Number(oracleAPR)), 18)
        const debtRatio = toNormalizedAmount(new BigNumberInt(Number(strategy.debtRatio)), 4)
        let scaledStrategyAPR = new Float().mul(humanizedAPR, debtRatio)

        // Scaling based on the performance fee
        // Retrieve the ratio we should use to take into account the performance fee. If the performance fee is 10%, the ratio is 0.9
        // 10_000 is the precision. Ex: 1 - (1000 / 10_000)
        const performanceFeeFloat = new Float().setInt(new BigNumberInt(BigNumber.from(strategy.performanceFee).toBigInt()))
        let performanceFee = new Float().div(performanceFeeFloat, new Float(10000))
        performanceFee = new Float().sub(new Float(1), performanceFee)
        scaledStrategyAPR = new Float().mul(humanizedAPR, performanceFee)

        debtRatioAPR = new Float().add(debtRatioAPR, scaledStrategyAPR)
      }

    }
  }

  /**********************************************************************************************
	** Define which APR we want to use as "Net APR".
	**********************************************************************************************/
  const primaryAPR = oracleAPR

  const primaryAPRFloat64 = primaryAPR.toFloat64()[0]
  const primaryAPY = new Float().setFloat64(convertFloatAPRToAPY(primaryAPRFloat64, 52))

  const oracleAPRFloat64 = oracleAPR.toFloat64()[0]
  const oracleAPY = new Float().setFloat64(convertFloatAPRToAPY(oracleAPRFloat64, 52))

  const debtRatioAPRFloat64 = debtRatioAPR.toFloat64()[0]
  const debtRatioAPY = new Float().setFloat64(convertFloatAPRToAPY(debtRatioAPRFloat64, 52))

  return {
  	type: 'v3:onchainOracle',
  	netAPY: primaryAPY.toFloat64()[0],
  	composite: {
  		v3OracleCurrentAPR:    oracleAPY.toFloat64()[0],
  		v3OracleStratRatioAPR: debtRatioAPY.toFloat64()[0],
  	},
  }
}
