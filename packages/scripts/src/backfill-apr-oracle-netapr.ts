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

async function backfillTimeseries(args: Args) {
  const candidates = await getTimeseriesCandidates(args)
  console.log(`timeseries candidates: ${candidates.length}`)
  if (candidates.length === 0) return

  const feeCache = new Map<string, { management: number; performance: number }>()
  const pending: Output[] = []
  let inserted = 0

  for (const [index, candidate] of candidates.entries()) {
    const cacheKey = `${candidate.chainId}:${candidate.address}:${candidate.blockNumber}`
    let fees = feeCache.get(cacheKey)

    if (!fees) {
      try {
        const strategies = await projectStrategies(candidate.chainId, candidate.address, candidate.blockNumber)
        fees = await extractFees__v3(candidate.chainId, candidate.address, strategies, candidate.blockNumber)
      } catch {
        fees = { management: 0, performance: 0 }
      }
      feeCache.set(cacheKey, fees)
    }

    const netApr = computeNetApr(candidate.apr, fees)
    const netApy = computeApy(netApr)

    if (!candidate.hasNetApr) {
      pending.push({
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
      pending.push({
        chainId: candidate.chainId,
        address: candidate.address,
        label: 'apr-oracle',
        component: 'netApy',
        value: netApy,
        blockNumber: candidate.blockNumber,
        blockTime: candidate.blockTime,
      })
    }

    if (pending.length >= WRITE_BATCH_SIZE) {
      const batch = pending.splice(0)
      if (args.apply && batch.length > 0) await upsertBatchOutput(batch)
      inserted += batch.length
    }

    if ((index + 1) % 500 === 0 || index === candidates.length - 1) {
      console.log(`processed ${index + 1}/${candidates.length} timeseries rows`)
    }
  }

  if (pending.length > 0) {
    const batch = pending.splice(0)
    if (args.apply && batch.length > 0) await upsertBatchOutput(batch)
    inserted += batch.length
  }

  console.log(`${args.apply ? 'upserted' : 'prepared (dry-run)'}: ${inserted} timeseries outputs`)
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
