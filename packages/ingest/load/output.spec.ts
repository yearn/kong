import { describe, expect, it, vi } from 'vitest'
import { endOfDay } from 'lib/dates'
import { OutputSchema } from 'lib/types'
import db, { toUpsertSql } from '../db'
import { upsertBatchOutput } from './index'

const ADDRESS = '0x00000000000000000000000000000000000000f1'
const CHAIN_ID = 1
const LABEL = 'prepared-output-spec'
const COMPONENT = 'tvl'
const BLOCK_TIME = 1_700_000_000n
const PK = 'chain_id, address, label, component, series_time'

describe('prepared output upserts', () => {
  it('reuses a statement on one connection and preserves duplicate, omitted, and NULL semantics', async () => {
    const client = await db.connect()
    const connect = vi.spyOn(db, 'connect').mockImplementation(() => Promise.resolve(client))
    const release = vi.spyOn(client, 'release').mockImplementation(() => {})

    const base = {
      chainId: CHAIN_ID,
      address: ADDRESS,
      label: LABEL,
      component: COMPONENT,
      blockTime: BLOCK_TIME
    }

    try {
      await client.query('DELETE FROM output WHERE chain_id = $1 AND address = $2 AND label = $3', [CHAIN_ID, ADDRESS, LABEL])

      await upsertBatchOutput([
        { ...base, value: 123, blockNumber: 1n },
        { ...base, value: 456, blockNumber: 2n }
      ])

      const parsed = OutputSchema.parse({ ...base, value: 123, blockNumber: 1n })
      const sql = toUpsertSql('output', PK, { ...parsed, series_time: endOfDay(parsed.blockTime) })
      const prepared = await client.query(
        'SELECT name FROM pg_prepared_statements WHERE statement = $1',
        [sql]
      )
      expect(prepared.rows).toHaveLength(1)
      expect(prepared.rows[0].name).toMatch(/^kong_output_[a-f0-9]{48}$/)

      const readValue = async () => (await client.query(
        'SELECT value FROM output WHERE chain_id = $1 AND address = $2 AND label = $3',
        [CHAIN_ID, ADDRESS, LABEL]
      )).rows[0]?.value

      expect(Number(await readValue())).toBe(456)

      await upsertBatchOutput([{ ...base, blockNumber: 3n }])
      expect(Number(await readValue())).toBe(456)

      await upsertBatchOutput([{ ...base, value: null, blockNumber: 4n }])
      expect(await readValue()).toBeNull()
    } finally {
      await client.query('DELETE FROM output WHERE chain_id = $1 AND address = $2 AND label = $3', [CHAIN_ID, ADDRESS, LABEL])
      connect.mockRestore()
      release.mockRestore()
      client.release()
    }
  })
})
