import 'lib/global'

import db from 'ingest/db'

export async function promoteTempTable(tempTable: string): Promise<void> {
  try {
    const count = await db.query(`SELECT COUNT(*) FROM ${tempTable}`)
    const rowCount = Number(count.rows[0].count)
    console.log(`found ${rowCount} rows in ${tempTable}`)

    if (rowCount === 0) {
      console.log('nothing to upsert. Run compute.ts first.')
      return
    }

    const sample = await db.query(`
      SELECT chain_id, address, component, value, series_time
      FROM ${tempTable}
      ORDER BY chain_id, address, component, series_time
      LIMIT 20
    `)
    console.log('\nsample rows:')
    for (const row of sample.rows) {
      console.log(`  ${row.chain_id}:${row.address} ${row.component}=${Number(row.value).toFixed(6)} @ ${row.series_time.toISOString()}`)
    }

    const vaultCount = await db.query(`SELECT COUNT(DISTINCT (chain_id, address)) FROM ${tempTable}`)
    console.log(`\ndistinct vaults: ${vaultCount.rows[0].count}`)

    console.log('\nupserting...')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(`
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        SELECT chain_id, address, label, component, value, block_number, block_time, series_time
        FROM ${tempTable}
        ON CONFLICT (chain_id, address, label, component, series_time)
        DO UPDATE SET
          value = EXCLUDED.value,
          block_number = EXCLUDED.block_number,
          block_time = EXCLUDED.block_time
      `)
      console.log(`upserted ${result.rowCount} rows`)

      await client.query(`DROP TABLE ${tempTable}`)
      console.log(`dropped ${tempTable}`)

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
      console.error(`table ${tempTable} does not exist. Run compute.ts first.`)
      return
    }
    throw err
  }
}
