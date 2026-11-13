import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  throw new Error('Set DATABASE_URL explicitly in this package .env or shell before applying the cache schema')
}

const sql = await readFile(new URL('../migrations/001-neon-rest-cache.sql', import.meta.url), 'utf8')
const pool = new Pool({ connectionString: databaseUrl, max: 1 })
try {
  await pool.query(sql)
  console.log('Applied migrations/001-neon-rest-cache.sql')
} finally {
  await pool.end()
}
