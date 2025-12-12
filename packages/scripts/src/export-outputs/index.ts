import { Pool } from 'pg'
import 'dotenv/config'
import { parseArgs } from 'util'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    label: { type: 'string', short: 'l' },
    components: { type: 'string', short: 'c' },
    start: { type: 'string', short: 's', default: '2024-01-01' },
  },
})

if (!values.label) {
  console.error('Usage: bun export-outputs --label <label> [--components <comp1,comp2>] [--start <YYYY-MM-DD>]')
  console.error('  --label, -l      Required. Output label to export (e.g., "apr-oracle", "tvl-c")')
  console.error('  --components, -c Optional. Comma-separated list of components to export')
  console.error('  --start, -s      Optional. Start date (default: 2024-01-01)')
  process.exit(1)
}

const LABEL = values.label
const COMPONENTS = values.components?.split(',').map(c => c.trim()) ?? []
const START_DATE = values.start!

const sourcePool = new Pool({
  host: process.env.SOURCE_POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.SOURCE_POSTGRES_PORT ?? 5432),
  ssl: (process.env.SOURCE_POSTGRES_SSL === 'true')
    ? (process.env.SOURCE_POSTGRES_SSL_REJECT_UNAUTHORIZED === 'false')
      ? { rejectUnauthorized: false }
      : true
    : false,
  database: process.env.SOURCE_POSTGRES_DATABASE ?? 'kong',
  user: process.env.SOURCE_POSTGRES_USER ?? 'user',
  password: process.env.SOURCE_POSTGRES_PASSWORD ?? 'password',
  statement_timeout: 60000,
})

const targetPool = new Pool({
  host: process.env.TARGET_POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.TARGET_POSTGRES_PORT ?? 5432),
  ssl: (process.env.TARGET_POSTGRES_SSL === 'true')
    ? (process.env.TARGET_POSTGRES_SSL_REJECT_UNAUTHORIZED === 'false')
      ? { rejectUnauthorized: false }
      : true
    : false,
  database: process.env.TARGET_POSTGRES_DATABASE ?? 'kong',
  user: process.env.TARGET_POSTGRES_USER ?? 'user',
  password: process.env.TARGET_POSTGRES_PASSWORD ?? 'password',
  statement_timeout: 120000,
})

interface Output {
  chain_id: number
  address: string
  block_number: string
  block_time: string
  series_time: string
  label: string
  component: string
  value: number
}

const BATCH_SIZE = 500

function timestamp() {
  return new Date().toISOString()
}

function buildWhereClause(): { clause: string; params: any[] } {
  const conditions: string[] = ['label = $1', 'series_time >= $2']
  const params: any[] = [LABEL, START_DATE]

  if (COMPONENTS.length > 0) {
    const placeholders = COMPONENTS.map((_, i) => `$${i + 3}`).join(', ')
    conditions.push(`component IN (${placeholders})`)
    params.push(...COMPONENTS)
  }

  return { clause: conditions.join(' AND '), params }
}

async function copyOutputs() {
  console.log(`[${timestamp()}] Starting output copy...`)
  console.log(`[${timestamp()}] Label: ${LABEL}`)
  console.log(`[${timestamp()}] Components: ${COMPONENTS.length > 0 ? COMPONENTS.join(', ') : 'all'}`)
  console.log(`[${timestamp()}] Start date: ${START_DATE}`)

  try {
    console.log(`[${timestamp()}] Testing source connection...`)
    await sourcePool.query('SELECT 1')
    console.log(`[${timestamp()}] Connected to source database`)

    console.log(`[${timestamp()}] Testing target connection...`)
    await targetPool.query('SELECT 1')
    console.log(`[${timestamp()}] Connected to target database`)

    const { clause, params } = buildWhereClause()

    console.log(`[${timestamp()}] Counting outputs...`)
    const countResult = await sourcePool.query(
      `SELECT COUNT(*) as count FROM output WHERE ${clause}`,
      params
    )
    const totalCount = parseInt(countResult.rows[0].count)
    console.log(`[${timestamp()}] Found ${totalCount.toLocaleString()} outputs to copy`)

    if (totalCount === 0) {
      console.log(`[${timestamp()}] No records to copy`)
      return
    }

    const sourceClient = await sourcePool.connect()
    let copiedCount = 0
    let batchNum = 0

    try {
      console.log(`[${timestamp()}] Starting cursor-based iteration...`)

      await sourceClient.query('BEGIN')

      // Build cursor query with parameterized WHERE clause
      const cursorQuery = `
        DECLARE cursor CURSOR FOR
        SELECT
          chain_id,
          address,
          block_number,
          block_time,
          series_time,
          label,
          component,
          value
        FROM output
        WHERE ${clause}
        ORDER BY series_time, chain_id, address, component
      `
      await sourceClient.query(cursorQuery, params)

      while (true) {
        batchNum++
        console.log(`[${timestamp()}] Fetching batch ${batchNum}...`)

        const result = await sourceClient.query<Output>(
          `FETCH ${BATCH_SIZE} FROM cursor`
        )

        if (result.rows.length === 0) {
          console.log(`[${timestamp()}] No more rows to fetch`)
          break
        }

        console.log(`[${timestamp()}] Inserting ${result.rows.length} rows into target...`)

        const CHUNK_SIZE = 100
        for (let i = 0; i < result.rows.length; i += CHUNK_SIZE) {
          const chunk = result.rows.slice(i, i + CHUNK_SIZE)
          const values: any[] = []
          const placeholders: string[] = []

          chunk.forEach((row, idx) => {
            const base = idx * 8
            placeholders.push(
              `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
            )
            values.push(
              row.chain_id,
              row.address,
              row.block_number,
              row.block_time,
              row.series_time,
              row.label,
              row.component,
              row.value
            )
          })

          await targetPool.query(
            `INSERT INTO output
              (chain_id, address, block_number, block_time, series_time, label, component, value)
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (chain_id, address, label, component, series_time)
            DO NOTHING`,
            values
          )
        }

        copiedCount += result.rows.length
        const progress = ((copiedCount / totalCount) * 100).toFixed(1)
        console.log(`[${timestamp()}] Batch ${batchNum} complete | ${copiedCount.toLocaleString()} / ${totalCount.toLocaleString()} (${progress}%)`)
      }

      await sourceClient.query('CLOSE cursor')
      await sourceClient.query('COMMIT')

    } finally {
      sourceClient.release()
    }

    console.log(`[${timestamp()}] Copy completed successfully!`)
    console.log(`[${timestamp()}] Total records copied: ${copiedCount.toLocaleString()}`)

  } catch (error) {
    console.error(`[${timestamp()}] Error during copy:`, error)
    throw error
  } finally {
    await sourcePool.end()
    await targetPool.end()
    console.log(`[${timestamp()}] Database connections closed`)
  }
}

copyOutputs()
  .then(() => {
    console.log('Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
