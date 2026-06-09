import { expect } from 'chai'
import { OutputSchema } from './types'

const mock = {
  chainId: 1,
  address: '0x0000000000000000000000000000000000000001',
  label: 'label',
  component: 'component',
  value: 1,
  blockNumber: 1n,
  blockTime: 1n
}

describe('types', function() {
  it('parses outputs', async function() {
    const output = OutputSchema.parse(mock)
    expect(output).to.deep.equal(mock)
    expect(OutputSchema.parse({ ...output, value: undefined }).value).to.be.undefined
    expect(OutputSchema.parse({ ...output, value: null }).value).to.be.null
    expect(OutputSchema.parse({ ...output, value: NaN }).value).to.be.undefined
    expect(OutputSchema.parse({ ...output, value: Infinity }).value).to.be.undefined
    expect(OutputSchema.parse({ ...output, value: 'string' }).value).to.be.undefined
    expect(OutputSchema.parse({ ...output, value: {} }).value).to.be.undefined
  })
})
