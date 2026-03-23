import 'lib/global'

import { Pool } from 'pg'

const COMPONENTS = ['netApr', 'netApy']
const READ_BATCH_SIZE = 10_000
const WRITE_BATCH_SIZE = 1_000
const WRITE_CONCURRENCY = 10

function createPool(prefix: string): Pool {
  return new Pool({
    host: process.env[`${prefix}POSTGRES_HOST`] ?? 'localhost',
    port: (process.env[`${prefix}POSTGRES_PORT`] ?? 5432) as number,
    ssl: (process.env[`${prefix}POSTGRES_SSL`] ?? false)
      ? (process.env[`${prefix}POSTGRES_SSL_REJECT_UNAUTHORIZED`] ?? true)
        ? true
        : { rejectUnauthorized: false }
      : false,
    database: process.env[`${prefix}POSTGRES_DATABASE`] ?? 'user',
    user: process.env[`${prefix}POSTGRES_USER`] ?? 'user',
    password: process.env[`${prefix}POSTGRES_PASSWORD`] ?? 'password',
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 60_000,
  })
}

async function copyOutputs() {
  const forkDb = createPool('FORK_')
  const mainDb = createPool('')

  try {
    const countResult = await forkDb.query(`
      SELECT COUNT(*) AS total
      FROM output
      WHERE component = ANY($1)
    `, [COMPONENTS])
    const total = Number(countResult.rows[0].total)
    console.log(`source rows: ${total}`)
    if (total === 0) return

    let copied = 0
    let lastBlockTime: string | null = null

    while (true) {
      const params: (string | string[] | number)[] = [COMPONENTS, READ_BATCH_SIZE]
      let query: string

      if (lastBlockTime === null) {
        query = `
          SELECT chain_id, address, label, component, value, block_number, block_time, series_time
          FROM output
          WHERE component = ANY($1)
          ORDER BY block_time ASC, chain_id ASC, address ASC, component ASC
          LIMIT $2
        `
      } else {
        params.push(lastBlockTime)
        query = `
          SELECT chain_id, address, label, component, value, block_number, block_time, series_time
          FROM output
          WHERE component = ANY($1)
            AND (block_time, chain_id, address, component) > ($3::timestamptz, 0, '', '')
          ORDER BY block_time ASC, chain_id ASC, address ASC, component ASC
          LIMIT $2
        `
      }

      const result = await forkDb.query(query, params)
      if (result.rows.length === 0) break

      const rows = result.rows
      const last = rows[rows.length - 1]
      lastBlockTime = last.block_time instanceof Date
        ? last.block_time.toISOString()
        : String(last.block_time)

      const batches: typeof rows[] = []
      for (let i = 0; i < rows.length; i += WRITE_BATCH_SIZE) {
        batches.push(rows.slice(i, i + WRITE_BATCH_SIZE))
      }

      for (let i = 0; i < batches.length; i += WRITE_CONCURRENCY) {
        const chunk = batches.slice(i, i + WRITE_CONCURRENCY)
        await Promise.all(chunk.map(batch => upsertBatch(mainDb, batch)))
      }

      copied += rows.length
      console.log(`copied ${copied}/${total}`)
    }

    console.log(`done: copied ${copied} rows`)
  } finally {
    await forkDb.end()
    await mainDb.end()
  }
}

async function upsertBatch(pool: Pool, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return

  const values: unknown[] = []
  const rowClauses: string[] = []
  const COLS = 7

  for (const row of rows) {
    const offset = values.length
    values.push(
      row.chain_id,
      row.address,
      row.label,
      row.component,
      row.value,
      row.block_number,
      row.series_time,
    )
    const placeholders = Array.from({ length: COLS }, (_, i) => `$${offset + i + 1}`)
    rowClauses.push(`(${placeholders.join(', ')})`)
  }

  await pool.query(`
    INSERT INTO output (chain_id, address, label, component, value, block_number, series_time)
    VALUES ${rowClauses.join(',\n')}
    ON CONFLICT (chain_id, address, label, component, series_time)
    DO UPDATE SET
      value = EXCLUDED.value,
      block_number = EXCLUDED.block_number
  `, values)
}

async function main() {
  console.log(`copying [${COMPONENTS.join(', ')}] from fork to main`)
  await copyOutputs()
}

main().catch(error => {
  console.error('copy-output-fork-to-main', error)
  process.exit(1)
})
