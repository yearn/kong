import { expect } from 'chai'
import { types } from 'lib'
import { get, exist } from './things'
import { upsertBatch } from './load'
import db from './db'

describe('things', function() {
  this.beforeEach(async function() {
    const thinglet = { chainId: 1, label: 'vault' }
    this.things = [] as types.Thing[]
    this.things.push(...[
      { ...thinglet, address: '0x1', defaults: { apiVersion: '1.0.0' } } as types.Thing,
      { ...thinglet, address: '0x2', defaults: { apiVersion: '2.0.0' } } as types.Thing,
      { ...thinglet, address: '0x3', defaults: { apiVersion: '3.0.0' } } as types.Thing,
      { ...thinglet, address: '0x4', defaults: { apiVersion: '4.0.0' } } as types.Thing,
      { ...thinglet, address: '0x5', defaults: { label: 'mushi' } } as types.Thing
    ])
    await upsertBatch(this.things, 'thing', 'chain_id, address, label')
  })

  this.afterEach(async function() {
    for (const thing of this.things) {
      await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3', [thing.chainId, thing.address, thing.label])
    }
  })

  it('gets things >= apiVersion', async function() {
    const things = await get({
      label: 'vault',
      filter: [
        { field: 'apiVersion', op: '>=', value: '3.0.0' }
      ],
      skip: false,
      only: false
    })

    expect(things.length).to.equal(2)
    expect(things[0]).to.deep.equal(this.things[2])
    expect(things[1]).to.deep.equal(this.things[3])
  })

  it('gets things > and <= apiVersion', async function() {
    const things = await get({
      label: 'vault',
      filter: [
        { field: 'apiVersion', op: '>', value: '1.0.0' },
        { field: 'apiVersion', op: '<=', value: '3.0.0' }
      ],
      skip: false,
      only: false
    })

    expect(things.length).to.equal(2)
    expect(things[0]).to.deep.equal(this.things[1])
    expect(things[1]).to.deep.equal(this.things[2])
  })

  it('gets things by label', async function() {
    const things = await get({
      label: 'vault',
      filter: [{ field: 'label', op: '=', value: 'mushi' }],
      skip: false,
      only: false
    })

    expect(things.length).to.equal(1)
    expect(things[0]).to.deep.equal(this.things[4])
  })

  it('gets things by ~label', async function() {
    const things = await get({
      label: 'vault',
      filter: [{ field: 'label', op: '!=', value: 'mushi' }],
      skip: false,
      only: false
    })

    expect(things.length).to.equal(4)
    expect(things).to.deep.equal(this.things.slice(0, 4))
  })

  it('knows if things exist', async function() {
    expect(await exist(1, '0x1', 'vault')).to.be.true
    expect(await exist(1, '0xNaN', 'vault')).to.be.false
  })
})
