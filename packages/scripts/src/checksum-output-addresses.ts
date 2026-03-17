/**
 * Checksum lowercase addresses in the output table.
 *
 * Finds output rows where the address is lowercase instead of EIP-55 checksummed,
 * and updates them to use the correct checksummed format.
 */

import 'dotenv/config'
import { Pool } from 'pg'
import { getAddress } from 'viem'

async function main() {
  const db = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: (process.env.POSTGRES_PORT ?? 5432) as number,
    ssl: (process.env.POSTGRES_SSL ?? false)
      ? (process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED ?? true)
        ? true
        : { rejectUnauthorized: false }
      : false,
    database: process.env.POSTGRES_DATABASE ?? 'user',
    user: process.env.POSTGRES_USER ?? 'user',
    password: process.env.POSTGRES_PASSWORD ?? 'password',
  })

  const { rows: lowercased } = await db.query(`
    SELECT DISTINCT address FROM output
    WHERE address ~ '[a-f]' AND address !~ '[A-F]'
  `)

  console.log(`Found ${lowercased.length} lowercase addresses`)

  for (const { address } of lowercased) {
    const checksummed = getAddress(address)
    console.log(`${address} → ${checksummed}`)

    // Delete lowercase rows where a checksummed version already exists
    const deleted = await db.query(`
      DELETE FROM output
      WHERE address = $1
        AND (chain_id, address, label, component, series_time) IN (
          SELECT o1.chain_id, o1.address, o1.label, o1.component, o1.series_time
          FROM output o1
          JOIN output o2 ON o1.chain_id = o2.chain_id
            AND o2.address = $2
            AND o1.label = o2.label
            AND o1.component = o2.component
            AND o1.series_time = o2.series_time
          WHERE o1.address = $1
        )
    `, [address, checksummed])
    if (deleted.rowCount) console.log(`  deleted ${deleted.rowCount} duplicate rows`)

    // Update remaining lowercase rows that have no checksummed counterpart
    const updated = await db.query(
      `UPDATE output SET address = $1 WHERE address = $2`,
      [checksummed, address]
    )
    if (updated.rowCount) console.log(`  updated ${updated.rowCount} rows`)
  }

  console.log('done')
  await db.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
