import { expect } from 'chai'
import { EstimatedAprSchema, OutputSchema } from './types'

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

  it('parses estimated APR gross and net fields', async function() {
    const estimated = EstimatedAprSchema.parse({
      apr: 0.01,
      apy: 0.011,
      grossAPR: 0.02,
      grossAPY: 0.021,
      netAPR: 0.015,
      netAPY: 0.016,
      type: 'katana-estimated-apr',
      components: { baseNetAPY: 0.012 }
    })

    expect(estimated.grossAPR).to.equal(0.02)
    expect(estimated.grossAPY).to.equal(0.021)
    expect(estimated.netAPR).to.equal(0.015)
    expect(estimated.netAPY).to.equal(0.016)
  })
})
