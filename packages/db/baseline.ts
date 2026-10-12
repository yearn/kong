import { readMigrationFiles } from 'drizzle-orm/migrator'
import path from 'path'
import { Pool } from 'pg'
import config from './drizzle.config'

const [baseline] = readMigrationFiles({ migrationsFolder: path.join(__dirname, 'drizzle') })
const pool = new Pool(config.dbCredentials as object)

await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle')
await pool.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)')
const { rowCount } = await pool.query('SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1', [baseline.hash])
if (rowCount) console.log('baseline already applied')
else {
  await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [baseline.hash, baseline.folderMillis])
  console.log('baseline marked applied')
}
await pool.end()
