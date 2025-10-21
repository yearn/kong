import { rpcs } from 'lib/rpcs'
import { v3OracleAbi } from './abis/oracle'
import db, { first } from '../../../db'
import { VaultSchema } from 'lib/types'

const oracleENS = 'apr.oracle.v3.ychad.eth'

function getOracleAddress(chainId: number) {
  return rpcs.next(chainId).getEnsAddress({ name: oracleENS })
}

async function getStrategyOracleAPR({chainId, strategyAddress, blockNumber, oracleAddress}: {chainId: number, strategyAddress: `0x${string}`, blockNumber: bigint, oracleAddress: `0x${string}`}): Promise<bigint | undefined> {
  try {
    return rpcs.next(chainId).readContract({
      address: oracleAddress,
      abi: v3OracleAbi,
      functionName: 'getStrategyApr',
      args: [strategyAddress],
      blockNumber
    }) as Promise<bigint>
  }catch(error) {
    console.error(error)

    return undefined
  }
}

export async function computeFAPY(chainId: number, address: `0x${string}`, blockNumber: bigint) {
  const vault = await first(VaultSchema, `
    SELECT * FROM thing
    WHERE label = $1 AND chain_id = $2 AND address = $3
  `, ['vault', chainId, address])

  const result = await db.query(`
    SELECT
      thing.chain_id,
      thing.address,
      thing.defaults,
      snapshot.snapshot,
      snapshot.hook
    FROM thing
    JOIN snapshot
      ON thing.chain_id = snapshot.chain_id
      AND thing.address = snapshot.address
    WHERE thing.label = $1 AND (thing.chain_id = $2 OR $2 IS NULL)
    ORDER BY snapshot.hook->>'totalDebtUsd' DESC`,
  ['strategy', chainId])

  const strategies = result.rows.map(row => ({
    chainId: row.chain_id,
    address: row.address,
    ...row.defaults,
    ...row.snapshot,
    ...row.hook
  }))

  if(strategies.length === 0) return undefined

  const oracleAddress = await getOracleAddress(chainId)

  if(!oracleAddress) return undefined

  if(strategies.length === 1) {
    const strategyAddress = strategies[0].address
    const apr = await getStrategyOracleAPR({chainId, strategyAddress, blockNumber, oracleAddress})
    if(!apr) return undefined

    return BigInt(apr)
  }



  let debtRatio = 0n

  if(vault.totalAssets === 0n) {
    return undefined
  }

  for(const strategy of strategies) {
    const apr = await getStrategyOracleAPR({chainId, strategyAddress: strategy.address, blockNumber, oracleAddress})
    if(!apr) return undefined

    const performanceFee = (BigInt(strategy.performanceFee ?? 0) / BigInt(10000)) - BigInt(1)
    const scaledAPR = apr * BigInt(strategy.debtRatio ?? 0) * performanceFee


    debtRatio += BigInt(debtRatio) + BigInt(scaledAPR)
  }

  return debtRatio * BigInt(0.9)
}
