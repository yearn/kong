import { expect } from 'chai'
import db from '../db'
import { findMissingDays } from './timeseries'
import { upsertBatchOutput } from '../load'

const CHAIN_ID = 1
const ADDRESS = '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' as const
const LABEL = 'tvl'

// TZ=UTC is pinned in vitest.config.ts, so endOfDay(n * 86400) = n * 86400 + 86399
const day = (n: number) => BigInt(n * 86400 + 86399)

async function seed(days: bigint[]) {
  for (const d of days) {
    await db.query(`
      INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
      VALUES ($1, $2, $3, 'tvl', 1, 1, to_timestamp($4), to_timestamp($4))`,
    [CHAIN_ID, ADDRESS, LABEL, Number(d)])
  }
}

async function selectValue() {
  const result = await db.query(
    'SELECT value FROM output WHERE chain_id = $1 AND address = $2 AND label = $3',
    [CHAIN_ID, ADDRESS, LABEL])
  return result.rows[0]?.value
}

describe('fanout/timeseries', () => {
  afterEach(async () => {
    await db.query('DELETE FROM output WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
  })

  describe('findMissingDays', () => {
    it('returns only the gaps', async () => {
      await seed([day(1), day(2), day(4)])
      const missing = await findMissingDays(CHAIN_ID, ADDRESS, LABEL, day(1), day(5))
      expect(missing).to.deep.equal([day(3), day(5)])
    })

    it('returns nothing when every day is computed', async () => {
      await seed([day(1), day(2), day(3)])
      const missing = await findMissingDays(CHAIN_ID, ADDRESS, LABEL, day(1), day(3))
      expect(missing).to.deep.equal([])
    })

    it('treats a null-value tvl row as missing so price outages can heal', async () => {
      await seed([day(1), day(3)])
      await db.query(`
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        VALUES ($1, $2, $3, 'tvl', NULL, 1, to_timestamp($4), to_timestamp($4))`,
      [CHAIN_ID, ADDRESS, LABEL, Number(day(2))])
      const missing = await findMissingDays(CHAIN_ID, ADDRESS, LABEL, day(1), day(3))
      expect(missing).to.deep.equal([day(2)])
    })

    it('counts a real-zero tvl row as computed', async () => {
      await seed([day(1), day(3)])
      await db.query(`
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        VALUES ($1, $2, $3, 'tvl', 0, 1, to_timestamp($4), to_timestamp($4))`,
      [CHAIN_ID, ADDRESS, LABEL, Number(day(2))])
      const missing = await findMissingDays(CHAIN_ID, ADDRESS, LABEL, day(1), day(3))
      expect(missing).to.deep.equal([])
    })

    it('still counts any row as computed for non-tvl labels', async () => {
      const apy = 'apy-bwd-delta-pps'
      await db.query(`
        INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
        VALUES ($1, $2, $3, 'net', NULL, 1, to_timestamp($4), to_timestamp($4))`,
      [CHAIN_ID, ADDRESS, apy, Number(day(2))])
      const missing = await findMissingDays(CHAIN_ID, ADDRESS, apy, day(1), day(3))
      expect(missing).to.deep.equal([day(1), day(3)])
    })
  })

  describe('null output upsert', () => {
    // Mimic the real path: hook output → redis json roundtrip → load worker upsert.
    const roundtrip = (batch: object[]) => JSON.parse(JSON.stringify(batch))

    const output = (value: number | null, blockNumber: bigint) => ({
      chainId: CHAIN_ID, address: ADDRESS, label: LABEL, component: 'tvl',
      value, blockNumber, blockTime: day(1)
    })

    it('writes null over an existing value and a value over null', async () => {
      await upsertBatchOutput(roundtrip([output(123, 1n)]))
      expect(Number(await selectValue())).to.equal(123)

      await upsertBatchOutput(roundtrip([output(null, 2n)]))
      expect(await selectValue()).to.equal(null)

      await upsertBatchOutput(roundtrip([output(456, 3n)]))
      expect(Number(await selectValue())).to.equal(456)
    })
  })
})
