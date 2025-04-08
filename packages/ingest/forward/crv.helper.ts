import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { convexBaseStrategyAbi } from './convex-base-strategy.abi'
import { curveGaugeAbi } from './crv-gauge.abi'
import { strategyBaseAbi } from './strategy-base.abi'

type Address = `0x${string}`

export const getCurveBoost = async (chainID: number, voter: Address, gauge: Address) => {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env[`RPC_FULLNODE_${chainID}`]),
  })

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


  if(balanceOf && balanceOf < BigInt(0)) {
    if(chainID === 1) {
      return 2.5
    }
    return 1
  }

  const boost = workingBalance && balanceOf ? (workingBalance * 10n) / (balanceOf * 4n) : 0n

  return Number(boost)
}


export const determineConvexKeepCRV = async (chainID: number, strategy: any) => {
  if(!strategy.KeepCRV) {
    return 0
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env[`RPC_FULLNODE_${chainID}`]),
  })

  const useLocalCRV = await client.readContract({
    address: strategy.Address,
    abi: convexBaseStrategyAbi,
    functionName: 'uselLocalCRV',
  })

  if(useLocalCRV) {
    try {
      const cvxKeepCRV = await client.readContract({
        address: strategy.Address,
        abi: convexBaseStrategyAbi,
        functionName: 'cvxKeepCRV',
      })
      return Number(cvxKeepCRV)
    }catch(err) {
      const localKeepCRV = await client.readContract({
        address: strategy.Address,
        abi: convexBaseStrategyAbi,
        functionName: 'localKeepCRV',
      })
      return Number(localKeepCRV)
    }
  }


  const curveGlobal = await client.readContract({
    address: strategy.Address,
    abi: convexBaseStrategyAbi,
    functionName: 'curveGlobal',
  })

  const keepCRV = await client.readContract({
    address: curveGlobal as Address,
    abi: strategyBaseAbi,
    functionName: 'keepCRV',
  })

  return Number(keepCRV)

}
