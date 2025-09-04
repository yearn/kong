import { z } from 'zod'
import { ContractFunctionExecutionError, getAddress, parseAbi, zeroAddress } from 'viem'
import { ThingSchema, Tradeable, TradeableSchema, zhexstring } from 'lib/types'
import { fetchErc20PriceUsd } from '../../../../../prices'
import { priced } from 'lib/math'
import { rpcs } from '../../../../../rpcs'
import * as things from '../../../../../things'
import { mq } from 'lib'
import { estimateCreationBlock } from 'lib/blocks'
import { fetchOrExtractErc20, throwOnMulticallError } from '../../../lib'
import db, { firstRow } from '../../../../../db'
import { getStrategyMeta } from '../../../lib/meta'
import vaultAbi from '../../vault/abi'

const borkedVaults = [
  '0x718AbE90777F5B778B52D553a5aBaa148DD0dc5D'
]

const SnapshotSchema = z.object({
  vault: zhexstring,
  want: zhexstring,
  tradeFactory: zhexstring.optional()
})

export type Snapshot = z.infer<typeof SnapshotSchema>

export const RewardSchema = z.object({
  chainId: z.number(),
  address: zhexstring,
  name: z.string(),
  symbol: z.string(),
  decimals: z.bigint(),
  balance: z.bigint(),
  balanceUsd: z.number()
})

export type Reward = z.infer<typeof RewardSchema>

export const LenderStatusSchema = z.object({
  name: z.string(),
  assets: z.bigint(),
  rate: z.bigint(),
  address: zhexstring
})

export type LenderStatus = z.infer<typeof LenderStatusSchema>

export default async function process(chainId: number, address: `0x${string}`, data: object) {
  const snapshot = SnapshotSchema.parse(data)
  await processTradeFactory(chainId, snapshot)
  const { totalDebt, totalDebtUsd } = await extractTotalDebtFromSnapshot(chainId, address, snapshot)
  const lenderStatuses = await extractLenderStatuses(chainId, address)
  const lastReportDetail = await fetchLastReportDetail(chainId, address)
  const claims = await computeRewards(chainId, address, snapshot)
  const meta = await getStrategyMeta(chainId, address)
  return { totalDebt, totalDebtUsd, lenderStatuses, lastReportDetail, claims, meta }
}

async function processTradeFactory(chainId: number, snapshot: Snapshot) {
  if (!snapshot.tradeFactory || snapshot.tradeFactory === zeroAddress) return
  if (await things.exist(chainId, snapshot.tradeFactory, 'tradeFactory')) return

  const block = await estimateCreationBlock(chainId, snapshot.tradeFactory)
  const inceptBlock = block.number
  const inceptTime = block.timestamp
  await mq.add(mq.job.load.thing, ThingSchema.parse({
    chainId,
    address: snapshot.tradeFactory,
    label: 'tradeHandler',
    defaults: { inceptBlock, inceptTime }
  }))
}

async function extractTotalDebtFromSnapshot(chainId: number, strategy: `0x${string}`, snapshot: Snapshot) {
  return await extractTotalDebt(chainId, snapshot.vault, strategy, snapshot.want)
}

export async function extractTotalDebt(chainId: number, vault: `0x${string}`, strategy: `0x${string}`, want: `0x${string}`, blockNumber?: bigint) {
  if (borkedVaults.includes(getAddress(vault))) return {
    totalDebt: 0n,
    totalDebtUsd: 0
  }

  const status = await rpcs.next(chainId, blockNumber).readContract({
    address: vault, abi: vaultAbi, functionName: 'strategies',
    args: [strategy],
    blockNumber
  })

  const { priceUsd } = await fetchErc20PriceUsd(chainId, want, blockNumber)
  const erc20 = await fetchOrExtractErc20(chainId, want)

  return {
    totalDebt: status.totalDebt,
    totalDebtUsd: priced(status.totalDebt, erc20.decimals, priceUsd)
  }
}

export async function extractLenderStatuses(chainId: number, address: `0x${string}`, blockNumber?: bigint) {
  try {
    return (await rpcs.next(chainId, blockNumber).readContract({
      address, functionName: 'lendStatuses',
      abi: parseAbi([
        'struct lendStatus { string name; uint256 assets; uint256 rate; address add; }',
        'function lendStatuses() view returns (lendStatus[])'
      ]),
      blockNumber
    })).map(status => LenderStatusSchema.parse({
      name: status.name,
      assets: status.assets,
      rate: status.rate,
      address: status.add
    }))

  } catch(error) {
    if(error instanceof ContractFunctionExecutionError) return []
    throw error
  }
}

async function computeRewards(chainId: number, strategy: `0x${string}`, snapshot: Snapshot) {
  if (!snapshot.tradeFactory || snapshot.tradeFactory === zeroAddress) return []
  const tradeables = await fetchTradeables(chainId, strategy, snapshot.tradeFactory)
  const balances = await extractBalances(chainId, strategy, tradeables)

  const result: Reward[] = []

  for (const [i, t] of tradeables.entries()) {
    const erc20 = await fetchOrExtractErc20(chainId, t.token)
    const { priceUsd } = await fetchErc20PriceUsd(chainId, t.token)
    result.push({
      ...erc20,
      balance: balances[i],
      balanceUsd: priced(balances[i], t.decimals, priceUsd)
    })
  }

  return RewardSchema.array().parse(result)
}

async function fetchTradeables(chainId: number, strategy: `0x${string}`, tradeHandler: `0x${string}`) {
  const result = await db.query(`
    SELECT hook->'tradeables' as tradeables FROM snapshot WHERE chain_id = $1 AND address = $2`,
  [chainId, tradeHandler]
  )
  if (result.rows.length === 0) return []
  const tradeables = TradeableSchema.array().parse(result.rows[0].tradeables || [])
  return tradeables.filter(t => t.strategy === strategy)
}

async function extractBalances(chainId: number, strategy: `0x${string}`, tradeables: Tradeable[]) {
  const contracts = tradeables.map(t => ({
    address: t.token, functionName: 'balanceOf', args: [strategy],
    abi: parseAbi(['function balanceOf(address) view returns (uint256)'])
  }))

  const multicall = await rpcs.next(chainId).multicall({ contracts })
  throwOnMulticallError(multicall)
  return tradeables.map((t, i) => multicall[i].result!)
}

async function fetchLastReportDetail(chainId: number, address: `0x${string}`) {
  const row = await firstRow(`
  SELECT *
  FROM evmlog
  WHERE chain_id = $1
    AND address = $2
    AND event_name = 'Harvested'
  ORDER BY block_number DESC, log_index DESC
  LIMIT 1;`, [chainId, address])

  if (!row) return undefined

  return z.object({
    chainId: z.number(),
    address: zhexstring,
    blockNumber: z.bigint({ coerce: true }),
    blockTime: z.bigint({ coerce: true }),
    transactionHash: zhexstring,
    profit: z.bigint({ coerce: true }),
    loss: z.bigint({ coerce: true }),
    debtPayment: z.bigint({ coerce: true }),
    debtOutstanding: z.bigint({ coerce: true }),
    apr: z.object({
      gross: z.number(),
      net: z.number()
    }).default({ gross: 0, net: 0 }),
    profitUsd: z.number().default(0),
    lossUsd: z.number().default(0),
    debtPaymentUsd: z.number().default(0),
    debtOutstandingUsd: z.number().default(0)

  }).parse({
    chainId: row.chain_id,
    address: row.address,
    blockNumber: row.block_number,
    blockTime: row.block_time,
    transactionHash: row.transaction_hash,
    ...row.args,
    ...row.hook

  })
}
