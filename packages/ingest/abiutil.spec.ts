import { expect } from 'chai'
import abiutil from './abiutil'

describe('abiutil', function() {
  it('loads', async function() {
    const abi = await abiutil.load('yearn/3/registry')
    expect(abi).to.be.an('array')
  })

  it('filters events', async function() {
    const abi = await abiutil.load('yearn/3/registry')
    const events = abiutil.events(abi)
    expect(events.length).to.eq(3)
  })

  it('filters fields', async function() {
    const abi = await abiutil.load('yearn/3/registry')
    const fields = abiutil.fields(abi)
    expect(fields.length).to.eq(8)
  })

  it('includes pricePerShare in the Yearn v3 vault fields', async function() {
    const abi = await abiutil.load('yearn/3/vault')
    const fields = abiutil.fields(abi)
    expect(fields.some(field => field.name === 'pricePerShare')).to.equal(true)
  })

  it('excludes events', async function() {
    const abi = await abiutil.load('yearn/3/strategy')
    const events = abiutil.events(abi)
    expect(events.length).to.eq(13)
    const filtered = abiutil.exclude(['Transfer'], events)
    expect(filtered.length).to.eq(12)
  })
})
