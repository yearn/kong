import 'lib/global'

import { projectStrategies } from 'ingest/abis/yearn/3/vault/snapshot/hook'
import { computeApy, computeNetApr, extractFees__v3 } from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { upsertBatchOutput } from 'ingest/load'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import type { Output } from 'lib/types'
import { getAddress } from 'viem'

type Args = {
  apply: boolean
  chainId?: number
  address?: `0x${string}`
}

type TimeseriesCandidate = {
  chainId: number
  address: `0x${string}`
  blockNumber: bigint
  blockTime: bigint
  apr: number
  hasNetApr: boolean
  hasNetApy: boolean
}

const WRITE_BATCH_SIZE = 200

function parseArgs(argv: string[]): Args {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-netapr.ts [--apply] [--chain-id 1] [--address 0x...]

defaults:
  dry-run unless --apply is provided`)
    process.exit(0)
  }

  const chainId = getArg('--chain-id')
  const address = getArg('--address')

  return {
    apply: hasArg('--apply'),
    chainId: chainId ? Number(chainId) : undefined,
    address: address ? getAddress(address as `0x${string}`) : undefined,
  }
}

async function getTimeseriesCandidates(args: Args): Promise<TimeseriesCandidate[]> {
  const values: Array<number | string> = []
  const filters: string[] = []

  if (args.chainId !== undefined) {
    values.push(args.chainId)
    filters.push(`o.chain_id = $${values.length}`)
  }

  if (args.address) {
    values.push(args.address)
    filters.push(`o.address = $${values.length}`)
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

  const result = await db.query(`
    WITH grouped AS (
      SELECT
        o.chain_id AS "chainId",
        o.address,
        MAX(o.block_number) AS "blockNumber",
        EXTRACT(EPOCH FROM MAX(o.block_time))::bigint AS "blockTime",
        MAX(CASE WHEN o.component = 'apr' THEN o.value END) AS apr,
        BOOL_OR(o.component = 'netApr') AS "hasNetApr",
        BOOL_OR(o.component = 'netApy') AS "hasNetApy"
      FROM output o
      JOIN thing t
        ON t.chain_id = o.chain_id
        AND t.address = o.address
        AND t.label = 'vault'
        AND COALESCE((t.defaults->>'v3')::boolean, false)
      WHERE o.label = 'apr-oracle'
        AND o.component IN ('apr', 'netApr', 'netApy')
        ${whereClause}
      GROUP BY o.chain_id, o.address, o.series_time
    )
    SELECT *
    FROM grouped
    WHERE apr IS NOT NULL
      AND (NOT "hasNetApr" OR NOT "hasNetApy")
    ORDER BY "chainId", address, "blockNumber"
  `, values)

  return result.rows.map(row => ({
    chainId: row.chainId,
    address: row.address,
    blockNumber: BigInt(row.blockNumber),
    blockTime: BigInt(row.blockTime),
    apr: Number(row.apr),
    hasNetApr: Boolean(row.hasNetApr),
    hasNetApy: Boolean(row.hasNetApy),
  }))
}

async function prefetchFees(candidates: TimeseriesCandidate[]): Promise<Map<string, { management: number; performance: number }>> {
  const vaultMap = new Map<string, { chainId: number; address: `0x${string}`; blockNumber: bigint }>()
  for (const c of candidates) {
    const key = `${c.chainId}:${c.address}`
    const existing = vaultMap.get(key)
    if (!existing || c.blockNumber > existing.blockNumber) {
      vaultMap.set(key, { chainId: c.chainId, address: c.address, blockNumber: c.blockNumber })
    }
  }

  console.log(`fetching fees for ${vaultMap.size} unique vaults...`)
  const feeCache = new Map<string, { management: number; performance: number }>()

  const CONCURRENCY = 10
  const entries = [...vaultMap.entries()]
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async ([key, vault]) => {
      try {
        const strategies = await projectStrategies(vault.chainId, vault.address, vault.blockNumber)
        return { key, fees: await extractFees__v3(vault.chainId, vault.address, strategies, vault.blockNumber) }
      } catch {
        return { key, fees: { management: 0, performance: 0 } }
      }
    }))
    for (const { key, fees } of results) {
      feeCache.set(key, fees)
    }
    console.log(`fetched fees ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length}`)
  }

  return feeCache
}

const WRITE_CONCURRENCY = 5

async function backfillTimeseries(args: Args) {
  const candidates = await getTimeseriesCandidates(args)
  console.log(`timeseries candidates: ${candidates.length}`)
  if (candidates.length === 0) return

  const feeCache = await prefetchFees(candidates)
  const outputs: Output[] = []

  for (const candidate of candidates) {
    const fees = feeCache.get(`${candidate.chainId}:${candidate.address}`) ?? { management: 0, performance: 0 }
    const netApr = computeNetApr(candidate.apr, fees)
    const netApy = computeApy(netApr)

    if (!candidate.hasNetApr) {
      outputs.push({
        chainId: candidate.chainId,
        address: candidate.address,
        label: 'apr-oracle',
        component: 'netApr',
        value: netApr,
        blockNumber: candidate.blockNumber,
        blockTime: candidate.blockTime,
      })
    }

    if (!candidate.hasNetApy) {
      outputs.push({
        chainId: candidate.chainId,
        address: candidate.address,
        label: 'apr-oracle',
        component: 'netApy',
        value: netApy,
        blockNumber: candidate.blockNumber,
        blockTime: candidate.blockTime,
      })
    }
  }

  console.log(`computed ${outputs.length} outputs, writing...`)

  const batches: Output[][] = []
  for (let i = 0; i < outputs.length; i += WRITE_BATCH_SIZE) {
    batches.push(outputs.slice(i, i + WRITE_BATCH_SIZE))
  }

  let written = 0
  for (let i = 0; i < batches.length; i += WRITE_CONCURRENCY) {
    const chunk = batches.slice(i, i + WRITE_CONCURRENCY)
    if (args.apply) {
      await Promise.all(chunk.map(batch => upsertBatchOutput(batch)))
    }
    written += chunk.reduce((sum, b) => sum + b.length, 0)
    console.log(`written ${written}/${outputs.length} outputs`)
  }

  console.log(`${args.apply ? 'upserted' : 'prepared (dry-run)'}: ${outputs.length} timeseries outputs`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(args.apply ? 'apply mode' : 'dry-run mode')
  if (args.chainId !== undefined) console.log(`chainId=${args.chainId}`)
  if (args.address) console.log(`address=${args.address}`)

  await rpcs.up()

  try {
    await backfillTimeseries(args)
  } finally {
    await mq.down()
    await rpcs.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('backfill-apr-oracle-netapr', error)
  process.exit(1)
})
