import 'lib/global'

import _process from 'ingest/abis/yearn/lib/apy'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { mq } from 'lib'
import type { Output } from 'lib/types'
import { getAddress } from 'viem'

const TEMP_TABLE = 'output_temp_apy_backfill'
const CONCURRENCY = 50

function parseArgs(argv: string[]) {
  const getArg = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/historical-apy-backfill/compute.ts --vaults chainId:0xABC,... [--start 2025-01-01] [--end 2026-04-09] [--dry-run]

Recomputes apy-bwd-delta-pps for each existing output entry (by series_time)
using the live _process/_compute from ingest. Results go into ${TEMP_TABLE}.
Run upsert.ts to promote them to the output table.`)
    process.exit(0)
  }

  const vaultsArg = getArg('--vaults')
  if (!vaultsArg) {
    console.error('Required: --vaults chainId:0xABC,chainId:0xDEF,...')
    process.exit(1)
  }

  const vaults = vaultsArg.split(',').map(pair => {
    const [chainIdStr, address] = pair.split(':')
    return { chainId: Number(chainIdStr), address: getAddress(address as `0x${string}`) }
  })

  return {
    vaults,
    start: getArg('--start'),
    end: getArg('--end'),
    dryRun: hasArg('--dry-run'),
  }
}

async function getExistingBlockTimes(
  chainId: number, address: string, start?: string, end?: string
): Promise<{ blockTime: bigint; seriesTime: bigint }[]> {
  const params: (number | string | Date)[] = [chainId, address]
  let timeFilter = ''

  if (start) {
    params.push(new Date(start))
    timeFilter += ` AND series_time >= $${params.length}`
  }
  if (end) {
    params.push(new Date(end))
    timeFilter += ` AND series_time <= $${params.length}`
  }

  const result = await db.query(`
    SELECT DISTINCT series_time,
      EXTRACT(EPOCH FROM block_time)::bigint AS block_time_epoch
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = 'apy-bwd-delta-pps' ${timeFilter}
    ORDER BY series_time
  `, params)

  return result.rows.map((row: { series_time: bigint; block_time_epoch: string }) => ({
    blockTime: BigInt(row.block_time_epoch),
    seriesTime: row.series_time,
  }))
}

async function ensureTempTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TEMP_TABLE} (
      chain_id     integer NOT NULL,
      address      text NOT NULL,
      label        text NOT NULL,
      component    text NOT NULL,
      value        numeric,
      block_number bigint NOT NULL,
      block_time   timestamptz NOT NULL,
      series_time  timestamptz NOT NULL,
      PRIMARY KEY  (chain_id, address, label, component, series_time)
    )
  `)
  const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
  console.log(`Temp table ${TEMP_TABLE}: ${count.rows[0].count} existing rows`)
}

async function insertTempBatch(rows: Output[]) {
  if (rows.length === 0) return

  const values: string[] = []
  const params: (string | number | bigint | Date)[] = []
  let idx = 1

  for (const row of rows) {
    const blockTime = new Date(Number(row.blockTime) * 1000)
    // series_time = end of day for blockTime
    const d = new Date(blockTime)
    d.setUTCHours(23, 59, 59, 0)
    const seriesTime = d

    values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`)
    params.push(
      row.chainId, row.address, row.label, row.component ?? '',
      row.value ?? 0, row.blockNumber.toString(), blockTime, seriesTime
    )
    idx += 8
  }

  await db.query(`
    INSERT INTO ${TEMP_TABLE} (chain_id, address, label, component, value, block_number, block_time, series_time)
    VALUES ${values.join(', ')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET value = EXCLUDED.value, block_number = EXCLUDED.block_number, block_time = EXCLUDED.block_time
  `, params)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startTime = Date.now()

  await rpcs.up()

  console.log(args.dryRun ? 'DRY RUN mode' : 'COMPUTE mode')
  console.log(`Vaults: ${args.vaults.length}`)
  if (args.start) console.log(`Start: ${args.start}`)
  if (args.end) console.log(`End: ${args.end}`)

  if (!args.dryRun) {
    await ensureTempTable()
  }

  let totalEntries = 0
  let totalOutputs = 0
  let totalErrors = 0

  for (const vault of args.vaults) {
    const { chainId, address } = vault
    console.log(`\n--- ${chainId}:${address} ---`)

    const entries = await getExistingBlockTimes(chainId, address, args.start, args.end)
    console.log(`  ${entries.length} existing entries`)
    if (entries.length === 0) continue
    totalEntries += entries.length

    let processed = 0
    let errors = 0

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (entry) => {
        const outputs = await _process(chainId, address as `0x${string}`, 'vault', {
          abiPath: 'yearn/3/vault',
          chainId,
          address: address as `0x${string}`,
          outputLabel: 'apy-bwd-delta-pps',
          blockTime: entry.blockTime,
        })
        return { outputs, entry }
      }))

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { outputs } = result.value
          if (outputs.length > 0) {
            if (!args.dryRun) await insertTempBatch(outputs)
            totalOutputs += outputs.length
          }
          processed++
        } else {
          errors++
          totalErrors++
          console.error('  Error:', result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }

      process.stdout.write(`\r  ${processed}/${entries.length} processed, ${errors} errors`)
    }

    console.log()
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('\n=== Summary ===')
  console.log(`Vaults:     ${args.vaults.length}`)
  console.log(`Entries:    ${totalEntries}`)
  console.log(`Outputs:    ${totalOutputs}`)
  console.log(`Errors:     ${totalErrors}`)
  console.log(`Duration:   ${duration}s`)

  if (!args.dryRun) {
    const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
    console.log(`Temp table: ${count.rows[0].count} rows in ${TEMP_TABLE}`)
    console.log('\nRun upsert.ts to promote to the output table.')
  }

  await rpcs.down()
  await mq.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
