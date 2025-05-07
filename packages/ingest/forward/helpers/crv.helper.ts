import { convexBaseStrategyAbi } from '../abis/convex-base-strategy.abi'
import { curveGaugeAbi } from '../abis/crv-gauge.abi'
import { strategyBaseAbi } from '../abis/strategy-base.abi'
import { rpcs } from 'lib/rpcs'
import { StrategyWithIndicators } from 'lib/types'
import { BigNumberInt, toNormalizedAmount as toNormalizedIntAmount } from './bignumber-int'
import { BigNumber } from '@ethersproject/bignumber'
import { Float } from './bignumber-float'

type Address = `0x${string}`

export const getCurveBoost = async (chainID: number, voter: Address, gauge: Address) => {
  const client = rpcs.next(chainID)

  const [{result: workingBalance}, {result: balanceOf}] = await client.multicall({
    contracts: [
      {
        address: gauge,
        abi: curveGaugeAbi,
        functionName: 'working_balances',
        args: [voter],
      },
      {
        address: gauge,
        abi: curveGaugeAbi,
        functionName: 'balanceOf',
        args: [voter],
      },
    ],
  })


  if(balanceOf && BigNumber.from(balanceOf ?? '0').lte(BigNumber.from(0))) {
    if(chainID === 1) {
      return new Float(2.5).toNumber()
    }
    return new Float(1).toNumber()
  }


  const boost = new Float().div(
    toNormalizedIntAmount(
      new BigNumberInt().set(workingBalance ?? 0n),
      18
    ),
    new Float().mul(
      new Float(0.4),
      toNormalizedIntAmount(
        new BigNumberInt().set(balanceOf ?? 0n),
        18
      )
    )
  )


  return Number(boost)
}


export const determineConvexKeepCRV = async (chainID: number, strategy: StrategyWithIndicators) => {
  const client = rpcs.next(chainID)
  try {
    const uselLocalCRV = await client.readContract({
      address: strategy.address,
      abi: convexBaseStrategyAbi,
      functionName: 'uselLocalCRV',
    })

    if (uselLocalCRV) {
      try {
        const cvxKeepCRV = await client.readContract({
          address: strategy.address,
          abi: convexBaseStrategyAbi,
          functionName: 'keepCVX',
        }) as bigint

        return toNormalizedIntAmount(new BigNumberInt().set(BigInt(cvxKeepCRV)), 4)
      } catch (err) {
        try {
          const localKeepCRV = await client.readContract({
            address: strategy.address,
            abi: convexBaseStrategyAbi,
            functionName: 'localKeepCRV',
          }) as bigint

          return toNormalizedIntAmount(new BigNumberInt().set(BigInt(localKeepCRV)), 4)
        } catch (err) {
          return toNormalizedIntAmount(new BigNumberInt().set(BigInt(0)), 4)
        }
      }
    }

    const curveGlobal = await client.readContract({
      address: strategy.address,
      abi: convexBaseStrategyAbi,
      functionName: 'curveGlobal',
    }) as `0x${string}`

    if (!curveGlobal) {
      return new Float(0)
    }

    try {
      const keepCRV = await client.readContract({
        address: curveGlobal as Address,
        abi: strategyBaseAbi,
        functionName: 'keepCRV',
      }) as bigint

      return toNormalizedIntAmount(new BigNumberInt().set(BigInt(keepCRV)), 4)
    } catch (err) {
      return toNormalizedIntAmount(new BigNumberInt().set(BigInt(0)), 4)
    }
  } catch (err) {
    return toNormalizedIntAmount(new BigNumberInt().set(BigInt(0)), 4)
  }
}
