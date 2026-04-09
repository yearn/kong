import 'lib/global'

import db from 'ingest/db'
import { mq } from 'lib'

const TEMP_TABLE = 'output_temp_apy_backfill'

function parseArgs(argv: string[]) {
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/historical-apy-backfill/upsert.ts [--dry-run]

Promotes rows from ${TEMP_TABLE} into the output table and drops the temp table.
Run compute.ts first to populate the temp table.`)
    process.exit(0)
  }

  return {
    dryRun: hasArg('--dry-run'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  console.log(args.dryRun ? 'DRY RUN mode' : 'UPSERT mode')

  // Verify temp table exists and has data
  try {
    const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
    const rowCount = Number(count.rows[0].count)
    console.log(`Found ${rowCount} rows in ${TEMP_TABLE}`)

    if (rowCount === 0) {
      console.log('Nothing to upsert. Run compute.ts first.')
      await mq.down()
      await db.end()
      return
    }

    // Preview: sample some rows
    const sample = await db.query(`
      SELECT chain_id, address, component, value, series_time
      FROM ${TEMP_TABLE}
      ORDER BY chain_id, address, series_time DESC
      LIMIT 10
    `)
    console.log('\nSample rows:')
    for (const row of sample.rows) {
      const date = new Date(Number(row.series_time) * 1000).toISOString().split('T')[0]
      console.log(`  ${row.chain_id}:${row.address} ${row.component}=${row.value} (${date})`)
    }

    // Count distinct vaults
    const vaultCount = await db.query(`
      SELECT COUNT(DISTINCT (chain_id, address)) FROM ${TEMP_TABLE}
    `)
    console.log(`\nDistinct vaults: ${vaultCount.rows[0].count}`)

    if (args.dryRun) {
      console.log('\nDRY RUN: no changes made.')
      await mq.down()
      await db.end()
      return
    }

    // Upsert and drop in a single transaction
    console.log('\nUpserting...')
    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const result = await client.query(`
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        SELECT chain_id, address, label, component, value, block_number, block_time, series_time
        FROM ${TEMP_TABLE}
        ON CONFLICT (chain_id, address, label, component, series_time)
        DO UPDATE SET
          value = EXCLUDED.value,
          block_number = EXCLUDED.block_number,
          block_time = EXCLUDED.block_time
      `)
      console.log(`Upserted ${result.rowCount} rows`)

      await client.query(`DROP TABLE ${TEMP_TABLE}`)
      console.log(`Dropped ${TEMP_TABLE}`)

      await client.query('COMMIT')
      console.log('Done.')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42P01') {
      console.error(`Table ${TEMP_TABLE} does not exist. Run compute.ts first.`)
    } else {
      throw err
    }
  }

  await mq.down()
  await db.end()
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
