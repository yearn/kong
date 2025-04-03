import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { curveGaugeAbi } from './crv-gauge.abi'

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

  return boost
}


export const determineConvexKeepCRV = async (chainID: number, strategy: any) => {
  if(!strategy.KeepCRV) {
    return 0
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env[`RPC_FULLNODE_${chainID}`]),
  })

  const convexStrategy = await client.readContract({
    address: strategy.Address,
    abi: convexStrategyAbi,
    functionName: 'keepCRV',
  })


  // if strategy.KeepCRV == nil {
  // 	return storage.ZERO
  // }
  // client := ethereum.GetRPC(strategy.ChainID)
  // convexStrategyContract, _ := contracts.NewConvexBaseStrategy(strategy.Address, client)
  // useLocalCRV, err := convexStrategyContract.UselLocalCRV(nil)
  // if err != nil {
  // 	return helpers.ToNormalizedAmount(strategy.KeepCRV, 4)
  // }
  // if useLocalCRV {
  // 	cvxKeepCRV, err := convexStrategyContract.LocalCRV(nil)
  // 	if err != nil {
  // 		localKeepCRV, err := convexStrategyContract.LocalKeepCRV(nil)
  // 		if err != nil {
  // 			return storage.ZERO
  // 		}
  // 		return helpers.ToNormalizedAmount(bigNumber.NewInt(0).Set(localKeepCRV), 4)
  // 	}
  // 	return helpers.ToNormalizedAmount(bigNumber.NewInt(0).Set(cvxKeepCRV), 4)
  // }
  // curveGlobal, err := convexStrategyContract.CurveGlobal(nil)
  // if err != nil {
  // 	return storage.ZERO
  // }
  // curveGlobalContract, err := contracts.NewStrategyBase(curveGlobal, client)
  // if err != nil {
  // 	return storage.ZERO
  // }
  // keepCRV, err := curveGlobalContract.KeepCRV(nil)
  // if err != nil {
  // 	return storage.ZERO
  // }
  // return helpers.ToNormalizedAmount(bigNumber.NewInt(0).Set(keepCRV), 4)
}
