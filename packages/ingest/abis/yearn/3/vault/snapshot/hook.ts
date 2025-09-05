import { z } from 'zod'
import { parseAbi, toEventSelector, zeroAddress } from 'viem'
import { rpcs } from '../../../../../rpcs'
import { EvmAddressSchema, ThingSchema, TokenMetaSchema, VaultMetaSchema, zhexstring } from 'lib/types'
import { mq } from 'lib'
import { estimateCreationBlock } from 'lib/blocks'
import db, { getLatestApy, getSparkline } from '../../../../../db'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { priced } from 'lib/math'
import { getRiskScore } from '../../../lib/risk'
import { getTokenMeta, getVaultMeta } from '../../../lib/meta'
import { snakeToCamelCols } from 'lib/strings'
import { fetchOrExtractErc20 } from '../../../lib'
import { Roles } from '../../../lib/types'
import accountantAbi from '../../accountant/abi'
import * as things from '../../../../../things'

export const ResultSchema = z.object({
  strategies: z.array(zhexstring),
  allocator: zhexstring.optional(),
  debts: z.array(z.object({
    strategy: zhexstring,
    currentDebt: z.bigint(),
    currentDebtUsd: z.number(),
    maxDebt: z.bigint(),
    maxDebtUsd: z.number(),
    targetDebtRatio: z.number().optional(),
    maxDebtRatio: z.number().optional()
  })),
  fees: z.object({
    managementFee: z.number(),
    performanceFee: z.number()
  }),
  meta: VaultMetaSchema.merge(z.object({ token: TokenMetaSchema }))
})

export const SnapshotSchema = z.object({
  accountant: EvmAddressSchema.optional(),
  role_manager: EvmAddressSchema.optional(),
  use_default_queue: z.boolean().optional(),
  get_default_queue: EvmAddressSchema.array().optional()
})

type Snapshot = z.infer<typeof SnapshotSchema>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const snapshot = SnapshotSchema.parse(data)
  const strategies = await projectStrategies(chainId, address, undefined, snapshot)
  const roles = await projectRoles(chainId, address)
  if (snapshot.role_manager) appendRoleManagerPseudoRole(roles, snapshot.role_manager)

  const allocator = await projectDebtAllocator(chainId, address)

  const debts = await extractDebts(chainId, address, strategies, allocator)
  const fees = await extractFeesBps(chainId, address, snapshot)
  const risk = await getRiskScore(chainId, address)
  const meta = await getVaultMeta(chainId, address)
  const token = await getTokenMeta(chainId, data.asset)
  const asset = await fetchOrExtractErc20(chainId, data.asset)

  if (snapshot.accountant) {
    if (snapshot.accountant !== zeroAddress && ! await things.exist(chainId, snapshot.accountant, 'accountant')) {
      const incept = await estimateCreationBlock(chainId, snapshot.accountant)
      await mq.add(mq.job.load.thing, ThingSchema.parse({
        chainId,
        address: snapshot.accountant,
        label: 'accountant',
        defaults: {
          inceptBlock: incept.number,
          inceptTime: incept.timestamp
        }
      }))
    }
  }

  const sparklines = {
    tvl: await getSparkline(chainId, address, 'tvl'),
    apy: await getSparkline(chainId, address, 'apy-bwd-delta-pps', 'net')
  }

  const apy = await getLatestApy(chainId, address)

  return {
    asset, strategies, allocator, roles, debts, fees,
    risk, meta: { ...meta, token },
    sparklines,
    tvl: sparklines.tvl[0],
    apy
  }
}

export async function projectStrategies(chainId: number, vault: `0x${string}`, blockNumber?: bigint, snapshot?: Snapshot) {
  const changeType = { [2 ** 0]: 'add', [2 ** 1]: 'revoke' }
  const topic = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
  const events = await db.query(`
  SELECT args
  FROM evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = $3 AND (block_number <= $4 OR $4 IS NULL)
  ORDER BY block_number ASC, log_index ASC`,
  [chainId, vault, topic, blockNumber])
  if(events.rows.length === 0) return []
  const result: `0x${string}`[] = []
  for (const event of events.rows) {
    if (changeType[event.args.change_type] === 'add') {
      result.push(zhexstring.parse(event.args.strategy))
    } else {
      result.splice(result.indexOf(zhexstring.parse(event.args.strategy)), 1)
    }
  }

  for (const strategy of snapshot?.get_default_queue ?? []) {
    if (!result.includes(strategy)) { result.push(strategy) }
  }

  return result
}

export async function projectDebtAllocator(chainId: number, vault: `0x${string}`) {
  const topic = toEventSelector('event NewDebtAllocator(address indexed allocator, address indexed vault)')
  const events = await db.query(`
  SELECT args
  FROM evmlog
  WHERE chain_id = $1 AND signature = $2 AND args->>'vault' = $3
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1`,
  [chainId, topic, vault])
  if(events.rows.length === 0) return undefined
  return zhexstring.parse(events.rows[0].args.allocator)
}

export async function projectRoles(chainId: number, vault: `0x${string}`) {
  const topic = toEventSelector('event RoleSet(address indexed account, uint256 indexed role)')
  const roles = await db.query(`
  WITH ranked AS (
    SELECT
      args->>'account' as account,
      (args->>'role')::bigint as role_mask,
      ROW_NUMBER() OVER(PARTITION BY args->'account' ORDER BY block_number DESC, log_index DESC) AS rn
    FROM evmlog
    WHERE
      chain_id = $1
      AND address = $2
      AND signature = $3
    ORDER BY block_number DESC, log_index DESC
  )

  SELECT account, role_mask FROM ranked WHERE rn = 1;`,
  [chainId, vault, topic])

  return z.object({
    account: zhexstring,
    roleMask: z.bigint({ coerce: true })
  }).array().parse(snakeToCamelCols(roles.rows))
}

function appendRoleManagerPseudoRole(
  roles: { account: `0x${string}`, roleMask: bigint }[],
  roleManager: `0x${string}`
) {
  const account = roles.find(r => r.account === roleManager)
  if (account) {
    account.roleMask |= BigInt(Roles.ROLE_MANAGER)
  } else {
    roles.push({ account: roleManager, roleMask: BigInt(Roles.ROLE_MANAGER) })
  }
}

export async function extractDebts(chainId: number, vault: `0x${string}`, strategies: `0x${string}`[], allocator: `0x${string}` | undefined) {
  const results: {
    strategy: `0x${string}`,
    currentDebt: bigint,
    currentDebtUsd: number,
    maxDebt: bigint,
    maxDebtUsd: number,
    targetDebtRatio: number | undefined,
    maxDebtRatio: number | undefined
  }[] = []

  const snapshot = await db.query(
    `SELECT
      snapshot->'asset' AS asset,
      snapshot->'decimals' AS decimals
    FROM snapshot
    WHERE chain_id = $1 AND address = $2`,
    [chainId, vault]
  )

  const { asset, decimals } = z.object({
    asset: zhexstring.nullish(),
    decimals: z.number({ coerce: true }).nullish()
  }).parse(snapshot.rows[0] || {})

  if (asset && decimals && strategies) {
    for (const strategy of strategies) {
      const contracts: any[] = [{
        address: vault, functionName: 'strategies', args: [strategy],
        abi: parseAbi(['function strategies(address) view returns (uint256, uint256, uint256, uint256)'])
      }]

      if (allocator) {
        contracts.push(
          {
            address: allocator, functionName: 'getStrategyTargetRatio', args: [strategy],
            abi: parseAbi(['function getStrategyTargetRatio(address) view returns (uint256)'])
          },
          {
            address: allocator, functionName: 'getStrategyMaxRatio', args: [strategy],
            abi: parseAbi(['function getStrategyMaxRatio(address) view returns (uint256)'])
          }
        )
      }

      const multicall = await rpcs.next(chainId).multicall({ contracts })

      const [activation, lastReport, currentDebt, maxDebt] = multicall[0].result
        ? multicall[0].result! as [bigint, bigint, bigint, bigint]
        : [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint]

      const targetDebtRatio = multicall[1]?.result
        ? Number(multicall[1].result)
        : undefined

      const maxDebtRatio = multicall[2]?.result
        ? Number(multicall[2].result)
        : undefined

      const price = await fetchErc20PriceUsd(chainId, asset)

      results.push({
        strategy,
        currentDebt,
        currentDebtUsd: priced(currentDebt, decimals, price.priceUsd),
        maxDebt,
        maxDebtUsd: priced(maxDebt, decimals, price.priceUsd),
        targetDebtRatio,
        maxDebtRatio
      })
    }
  }

  return results
}

export async function extractFeesBps(chainId: number, address: `0x${string}`, snapshot: Snapshot) {
  try {
    if(snapshot.accountant && snapshot.accountant !== zeroAddress) {
      const feeConfig = await rpcs.next(chainId).readContract({
        address: snapshot.accountant, abi: accountantAbi,
        functionName: 'getVaultConfig', args: [address]
      })
      return {
        managementFee: feeConfig[0],
        performanceFee: feeConfig[1]
      }
    } else {
      const performanceFee = await rpcs.next(chainId).readContract({
        address,
        abi: parseAbi(['function performanceFee() view returns (uint16)']),
        functionName: 'performanceFee'
      })
      return {
        managementFee: 0,
        performanceFee: performanceFee
      }
    }
  } catch {
    return {
      managementFee: 0,
      performanceFee: 0
    }
  }
}
