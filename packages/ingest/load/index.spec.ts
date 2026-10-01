import { expect } from 'chai'
import db from '../db'
import { upsertBatch } from '.'

const PK = 'chain_id, address, label, component, series_time'
const ADDRESS = '0xupsertbatch'

function output(seriesTime: number, extra: object = {}) {
  return { chainId: 1, address: ADDRESS, label: 'tvl', component: '', blockNumber: 1, blockTime: seriesTime, series_time: seriesTime, ...extra }
}

async function rows() {
  return (await db.query(
    'SELECT value, block_number, extract(epoch from block_time)::int8 AS bt, extract(epoch from series_time)::int8 AS st FROM output WHERE address = $1 ORDER BY series_time',
    [ADDRESS]
  )).rows
}

describe('load/upsertBatch', () => {
  afterEach(async () => {
    await db.query('DELETE FROM output WHERE address = $1', [ADDRESS])
  })

  it('upserts many rows', async () => {
    await upsertBatch([1000, 2000, 3000].map(t => output(t, { value: t })), 'output', PK)
    expect((await rows()).map(r => r.value)).to.deep.equal([1000, 2000, 3000])
  })

  it('chunks past 500 rows', async () => {
    await upsertBatch(Array.from({ length: 1201 }, (_, i) => output(1000 + i, { value: i })), 'output', PK)
    expect(await rows()).to.have.length(1201)
  })

  it('last row wins when a pk repeats in a batch', async () => {
    await upsertBatch([output(1000, { value: 1 }), output(1000, { value: 2 })], 'output', PK)
    const result = await rows()
    expect(result).to.have.length(1)
    expect(result[0].value).to.equal(2)
  })

  it('merges same-pk rows, keeping value from the earlier one', async () => {
    await upsertBatch([output(1000, { value: 4 }), output(1000, { blockNumber: 8 })], 'output', PK)
    const [row] = await rows()
    expect(row.value).to.equal(4)
    expect(Number(row.block_number)).to.equal(8)
  })

  it('updates non-pk columns on conflict', async () => {
    await upsertBatch([output(1000, { value: 1 })], 'output', PK)
    await upsertBatch([output(1000, { value: 5, blockNumber: 9 })], 'output', PK)
    const [row] = await rows()
    expect(row.value).to.equal(5)
    expect(Number(row.block_number)).to.equal(9)
  })

  it('leaves pk columns untouched on conflict', async () => {
    await upsertBatch([output(1000, { value: 1 })], 'output', PK)
    await upsertBatch([output(1000, { value: 2 })], 'output', PK)
    const [row] = await rows()
    expect(Number(row.st)).to.equal(1000)
  })

  it('keeps columns missing from a later row, mixed key sets in one batch', async () => {
    await upsertBatch([output(1000, { value: 1 }), output(2000, { value: 2 })], 'output', PK)

    const withoutValue = output(1000, { blockNumber: 7 })
    await upsertBatch([withoutValue, output(2000, { value: 3 })], 'output', PK)

    const result = await rows()
    expect(result[0].value).to.equal(1)
    expect(Number(result[0].block_number)).to.equal(7)
    expect(result[1].value).to.equal(3)
  })

  it('stores blockTime and series_time as timestamps', async () => {
    await upsertBatch([output(1_700_000_000, { value: 1 })], 'output', PK)
    const [row] = await rows()
    expect(Number(row.bt)).to.equal(1_700_000_000)
    expect(Number(row.st)).to.equal(1_700_000_000)
  })

  it('rolls back every chunk when one fails', async () => {
    const good = Array.from({ length: 600 }, (_, i) => output(1000 + i, { value: i }))
    const bad = { ...output(5000), address: null }
    await upsertBatch([...good, bad], 'output', PK).then(
      () => expect.fail('expected a failure'),
      error => expect(String(error)).to.contain('null value')
    )
    expect(await rows()).to.have.length(0)
  })
})
