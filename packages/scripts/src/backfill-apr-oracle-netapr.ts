import 'lib/global'

import { extractFeesBps } from 'ingest/abis/yearn/3/vault/snapshot/hook'
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

type VaultSnapshotRow = {
  chainId: number
  address: `0x${string}`
  snapshot: Record<string, unknown>
}

type FeeRates = {
  management: number
  performance: number
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

function computeFeeAdjustedApr(apr: number, fees: FeeRates): number {
  const next = apr * (1 - fees.performance) - fees.management
  return Number.isFinite(next) ? next : 0
}

function computeApy(apr: number): number {
  const next = (1 + apr / 52) ** 52 - 1
  return Number.isFinite(next) ? next : 0
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

async function getV3VaultSnapshots(args: Args): Promise<Map<string, Record<string, unknown>>> {
  const values: Array<number | string> = []
  const filters: string[] = []

  if (args.chainId !== undefined) {
    values.push(args.chainId)
    filters.push(`s.chain_id = $${values.length}`)
  }

  if (args.address) {
    values.push(args.address)
    filters.push(`s.address = $${values.length}`)
  }

  const whereClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''

  const result = await db.query(`
    SELECT
      s.chain_id AS "chainId",
      s.address,
      s.snapshot
    FROM snapshot s
    JOIN thing t
      ON t.chain_id = s.chain_id
      AND t.address = s.address
      AND t.label = 'vault'
      AND COALESCE((t.defaults->>'v3')::boolean, false)
    WHERE TRUE
      ${whereClause}
  `, values)

  const map = new Map<string, Record<string, unknown>>()
  for (const row of result.rows as VaultSnapshotRow[]) {
    map.set(`${row.chainId}:${row.address}`, row.snapshot ?? {})
  }

  return map
}

async function backfillTimeseries(args: Args) {
  const candidates = await getTimeseriesCandidates(args)
  console.log(`🕒 timeseries candidates: ${candidates.length}`)
  if (candidates.length === 0) return

  const snapshots = await getV3VaultSnapshots(args)
  const feesByVault = new Map<string, FeeRates>()
  const pending: Output[] = []
  let inserted = 0

  for (const [index, candidate] of candidates.entries()) {
    const vaultKey = `${candidate.chainId}:${candidate.address}`
    let fees = feesByVault.get(vaultKey)

    if (!fees) {
      const snapshot = snapshots.get(vaultKey)
      if (!snapshot) {
        console.warn(`🚨 missing snapshot for ${vaultKey}, defaulting fees to zero`)
        fees = { management: 0, performance: 0 }
      } else {
        const feeBps = await extractFeesBps(candidate.chainId, candidate.address, snapshot)
        fees = {
          management: feeBps.managementFee / 10_000,
          performance: feeBps.performanceFee / 10_000,
        }
      }
      feesByVault.set(vaultKey, fees)
    }

    const netApr = computeFeeAdjustedApr(candidate.apr, fees)
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
      console.log(`🕒 processed ${index + 1}/${candidates.length} timeseries rows`)
    }
  }

  if (pending.length > 0) {
    const batch = pending.splice(0)
    if (args.apply && batch.length > 0) await upsertBatchOutput(batch)
    inserted += batch.length
  }

  console.log(`${args.apply ? '✅' : '🧪'} timeseries outputs ${args.apply ? 'upserted' : 'prepared'}: ${inserted}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(args.apply ? '⚠️ apply mode' : '🧪 dry-run mode')
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
  console.error('🤬 backfill-apr-oracle-netapr', error)
  process.exit(1)
})
