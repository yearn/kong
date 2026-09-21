import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'chai'
import { PoolClient } from 'pg'
import db from './db'

const migrationSqlDir = path.resolve(__dirname, '../db/migrations/sqls')
const upSqlPath = path.join(migrationSqlDir, '20260921120000-reader-coverage-up.sql')
const downSqlPath = path.join(migrationSqlDir, '20260921120000-reader-coverage-down.sql')

const legacyTable = `
  CREATE TABLE evmlog_strides (
    chain_id int4 NOT NULL,
    address text NOT NULL,
    strides text NOT NULL,
    CONSTRAINT evmlog_strides_pkey PRIMARY KEY (chain_id, address)
  )
`

async function withMigrationSchema(run: (client: PoolClient) => Promise<void>) {
  const client = await db.connect()
  const schema = `reader_migration_${randomUUID().replaceAll('-', '')}`

  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await run(client)
  } finally {
    // A failed down migration leaves the transaction aborted. Rollback before
    // restoring the search path so the temporary schema can always be removed.
    await client.query('ROLLBACK').catch(() => undefined)
    await client.query('SET search_path TO public')
    await client.query(`DROP SCHEMA "${schema}" CASCADE`)
    client.release()
  }
}

async function primaryKeyDefinition(client: PoolClient) {
  const result = await client.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'evmlog_strides'::regclass AND contype = 'p'
  `)
  return result.rows[0]?.definition
}

describe('reader-specific evmlog_strides migration', () => {
  it('preserves legacy coverage and makes abi_path part of the key without a default', async () => {
    await withMigrationSchema(async client => {
      await client.query(legacyTable)
      await client.query(
        'INSERT INTO evmlog_strides (chain_id, address, strides) VALUES ($1, $2, $3), ($4, $5, $6)',
        [1, '0xlegacy-a', '[{"from":"10","to":"20"}]', 10, '0xlegacy-b', '[{"from":"30","to":"40"}]']
      )

      await client.query(await readFile(upSqlPath, 'utf8'))

      const legacyRows = await client.query(`
        SELECT chain_id, address, strides, abi_path
        FROM evmlog_strides
        ORDER BY chain_id, address
      `)
      expect(legacyRows.rows).to.deep.equal([
        { chain_id: 1, address: '0xlegacy-a', strides: '[{"from":"10","to":"20"}]', abi_path: '__legacy__' },
        { chain_id: 10, address: '0xlegacy-b', strides: '[{"from":"30","to":"40"}]', abi_path: '__legacy__' },
      ])

      const column = await client.query(`
        SELECT column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'evmlog_strides'
          AND column_name = 'abi_path'
      `)
      expect(column.rows).to.deep.equal([{ column_default: null, is_nullable: 'NO' }])
      expect(await primaryKeyDefinition(client)).to.equal('PRIMARY KEY (chain_id, address, abi_path)')

      await client.query(
        'INSERT INTO evmlog_strides (chain_id, address, abi_path, strides) VALUES ($1, $2, $3, $4), ($1, $2, $5, $4)',
        [1, '0xreader', 'erc4626', '[]', 'yearn/3/vault']
      )
      const readers = await client.query(
        'SELECT abi_path FROM evmlog_strides WHERE chain_id = $1 AND address = $2 ORDER BY abi_path',
        [1, '0xreader']
      )
      expect(readers.rows.map(row => row.abi_path)).to.deep.equal(['erc4626', 'yearn/3/vault'])
    })
  })

  it('refuses unsafe down migration and restores the legacy key after reader rows are removed', async () => {
    await withMigrationSchema(async client => {
      await client.query(legacyTable)
      await client.query(
        'INSERT INTO evmlog_strides (chain_id, address, strides) VALUES ($1, $2, $3)',
        [1, '0xlegacy', '[{"from":"10","to":"20"}]']
      )
      await client.query(await readFile(upSqlPath, 'utf8'))
      await client.query(
        'INSERT INTO evmlog_strides (chain_id, address, abi_path, strides) VALUES ($1, $2, $3, $4)',
        [1, '0xreader', 'erc4626', '[{"from":"30","to":"40"}]']
      )

      let rollbackError: unknown
      await client.query('BEGIN')
      try {
        await client.query(await readFile(downSqlPath, 'utf8'))
      } catch (error) {
        rollbackError = error
      }
      await client.query('ROLLBACK')

      expect(rollbackError).to.be.instanceOf(Error)
      expect(String(rollbackError)).to.contain('reader-specific coverage rows exist')
      expect(await primaryKeyDefinition(client)).to.equal('PRIMARY KEY (chain_id, address, abi_path)')

      await client.query('DELETE FROM evmlog_strides WHERE abi_path <> \'__legacy__\'')
      await client.query(await readFile(downSqlPath, 'utf8'))

      const column = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'evmlog_strides'
          AND column_name = 'abi_path'
      `)
      expect(column.rows).to.have.length(0)
      expect(await primaryKeyDefinition(client)).to.equal('PRIMARY KEY (chain_id, address)')

      const legacyRows = await client.query('SELECT chain_id, address, strides FROM evmlog_strides')
      expect(legacyRows.rows).to.deep.equal([
        { chain_id: 1, address: '0xlegacy', strides: '[{"from":"10","to":"20"}]' },
      ])
    })
  })
})
