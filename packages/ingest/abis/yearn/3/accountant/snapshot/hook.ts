import { parseAbi, toEventSelector } from 'viem'
import { z } from 'zod'
import db from '../../../../../db'
import { EvmAddressSchema } from 'lib/types'
import { rpcs } from '../../../../../rpcs'

export const ResultSchema = z.object({
  vaults: z.array(EvmAddressSchema),
  managementFeeThreshold: z.bigint().optional(),
  performanceFeeThreshold: z.bigint().optional()
})

export default async function process(chainId: number, address: `0x${string}`) {
  const vaults = await projectVaults(chainId, address)
  const thresholds = await extractHardCodedThresholds(chainId, address)
  return ResultSchema.parse({ vaults, ...thresholds })
}

export async function projectVaults(chainId: number, accountant: `0x${string}`, blockNumber?: bigint) {
  const changeType: {
    [key: number]: 'null' | 'add' | 'remove'
  } = { [0]: 'null', [1]: 'add', [2]: 'remove' }

  const topic = toEventSelector('event VaultChanged(address indexed vault, uint8 change)')
  const events = await db.query(`
  SELECT args
  FROM evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = $3 AND (block_number <= $4 OR $4 IS NULL)
  ORDER BY block_number ASC, log_index ASC`,
  [chainId, accountant, topic, blockNumber])

  if(events.rows.length === 0) return []

  const result: `0x${string}`[] = []
  for (const event of events.rows) {
    if (changeType[event.args.change] === 'add') {
      result.push(EvmAddressSchema.parse(event.args.vault))
    } else if (changeType[event.args.change] === 'remove') {
      result.splice(result.indexOf(EvmAddressSchema.parse(event.args.vault)), 1)
    }
  }

  return result
}

export async function extractHardCodedThresholds(chainId: number, accountant: `0x${string}`, blockNumber?: bigint) {
  const multicall = await rpcs.next(chainId, blockNumber).multicall({ contracts: [
    {
      address: accountant,
      abi: parseAbi(['function MANAGEMENT_FEE_THRESHOLD() view returns (uint256)']),
      functionName: 'MANAGEMENT_FEE_THRESHOLD'
    },
    {
      address: accountant,
      abi: parseAbi(['function PERFORMANCE_FEE_THRESHOLD() view returns (uint256)']),
      functionName: 'PERFORMANCE_FEE_THRESHOLD'
    }
  ], blockNumber })

  const result = {
    managementFeeThreshold: multicall[0].result,
    performanceFeeThreshold: multicall[1].result
  }

  return {
    ...(result.managementFeeThreshold && { managementFeeThreshold: result.managementFeeThreshold }),
    ...(result.performanceFeeThreshold && { performanceFeeThreshold: result.performanceFeeThreshold })
  }
}
