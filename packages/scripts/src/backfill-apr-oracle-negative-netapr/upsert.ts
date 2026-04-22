import 'lib/global'

import db from 'ingest/db'
import { mq } from 'lib'

/**
 * Phase 2: Promote floored netApr/netApy outputs from the temp table into the
 * production output table. Run compute.ts first.
 */

const TEMP_TABLE = 'output_temp_netapr_floor_backfill'

function parseArgs(argv: string[]) {
  const hasArg = (flag: string) => argv.includes(flag)

  if (hasArg('--help') || hasArg('-h')) {
    console.log(`usage:
  bun packages/scripts/src/backfill-apr-oracle-negative-netapr/upsert.ts [--dry-run]

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

  try {
    const count = await db.query(`SELECT COUNT(*) FROM ${TEMP_TABLE}`)
    const rowCount = Number(count.rows[0].count)
    console.log(`found ${rowCount} rows in ${TEMP_TABLE}`)

    if (rowCount === 0) {
      console.log('nothing to upsert. Run compute.ts first.')
      await mq.down()
      await db.end()
      return
    }

    const sample = await db.query(`
      SELECT chain_id, address, component, value, series_time
      FROM ${TEMP_TABLE}
      ORDER BY chain_id, address, component, series_time
      LIMIT 20
    `)
    console.log('\nsample rows:')
    for (const row of sample.rows) {
      console.log(`  ${row.chain_id}:${row.address} ${row.component}=${Number(row.value).toFixed(6)} @ ${row.series_time.toISOString()}`)
    }

    const vaultCount = await db.query(`
      SELECT COUNT(DISTINCT (chain_id, address)) FROM ${TEMP_TABLE}
    `)
    console.log(`\ndistinct vaults: ${vaultCount.rows[0].count}`)

    if (args.dryRun) {
      console.log('\nDRY RUN: no changes made.')
      await mq.down()
      await db.end()
      return
    }

    console.log('\nupserting...')
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
      console.log(`upserted ${result.rowCount} rows`)

      await client.query(`DROP TABLE ${TEMP_TABLE}`)
      console.log(`dropped ${TEMP_TABLE}`)

      await client.query('COMMIT')
      console.log('done.')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '42P01') {
      console.error(`table ${TEMP_TABLE} does not exist. Run compute.ts first.`)
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
