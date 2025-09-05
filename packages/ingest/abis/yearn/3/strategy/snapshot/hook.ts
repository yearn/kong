import { z } from 'zod'
import { zhexstring } from 'lib/types'
import { firstRow } from '../../../../../db'
import { fetchOrExtractErc20 } from '../../../lib'
import { getStrategyMeta } from '../../../lib/meta'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const asset = await fetchOrExtractErc20(chainId, data.asset)
  const meta = await getStrategyMeta(chainId, address)
  const lastReportDetail = await fetchLastReportDetail(chainId, address)
  return { asset, meta, lastReportDetail }
}

async function fetchLastReportDetail(chainId: number, address: `0x${string}`) {
  const row = await firstRow(`
  SELECT *
  FROM evmlog
  WHERE chain_id = $1
    AND address = $2
    AND event_name = 'Reported'
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
    protocolFees: z.bigint({ coerce: true }),
    performanceFees: z.bigint({ coerce: true }),
    apr: z.object({
      gross: z.number(),
      net: z.number()
    }).default({ gross: 0, net: 0 }),
    profitUsd: z.number().default(0),
    lossUsd: z.number().default(0),
    protocolFeesUsd: z.number().default(0),
    performanceFeesUsd: z.number().default(0),

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
