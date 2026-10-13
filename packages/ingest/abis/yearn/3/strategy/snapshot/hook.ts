import { z } from 'zod'
import { parseAbi, zeroAddress } from 'viem'
import { zhexstring } from 'lib/types'
import { rpcs } from '../../../../../rpcs'
import { firstRow } from '../../../../../db'
import { fetchOrExtractErc20 } from '../../../lib'
import { getStrategyMeta, getVaultMeta } from '../../../lib/meta'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const asset = await fetchOrExtractErc20(chainId, data.asset)
  const vaultMeta = await getVaultMeta(chainId, address)
  const meta = vaultMeta ?? await getStrategyMeta(chainId, address)
  const lastReportDetail = await fetchLastReportDetail(chainId, address)
  const aggregateTvlTarget = await extractAggregateTvlTarget(chainId, data)
  return { asset, meta, lastReportDetail, aggregateTvlTarget }
}

const isAddress = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && value !== zeroAddress

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function extractAggregateTvlTarget(chainId: number, data: any) {
  if (isAddress(data.REMOTE_COUNTERPART) && data.REMOTE_CHAIN_ID) {
    const remoteChainId = Number(data.REMOTE_CHAIN_ID)
    const remoteVault = await rpcs.next(remoteChainId).readContract({
      address: data.REMOTE_COUNTERPART,
      abi: parseAbi(['function vault() view returns (address)']),
      functionName: 'vault'
    }).catch(() => undefined)
    return isAddress(remoteVault) ? { chainId: remoteChainId, address: remoteVault } : null
  }
  const target = isAddress(data.vault) ? data.vault : isAddress(data.VAULT) ? data.VAULT : null
  return target ? { chainId, address: target } : null
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
