import { expect } from 'chai'
import { getAddress, pad, toEventSelector } from 'viem'
import { EvmLogSchema } from 'lib/types'
import abi from './abis/yearn/2/vault/abi'
import { mapEnvioRow, useEnvio } from './envio'

describe('envio', function() {
  it('maps an entity row to an EvmLog', function() {
    const strategy = '0x0000000000000000000000000000000000000001'
    const vault = '0x0000000000000000000000000000000000000002'
    const event = abi.find((e: any) => e.name === 'StrategyReported' && e.inputs.some((i: any) => i.name === 'debtPaid'))
    const row = {
      blockNumber: 100, blockTimestamp: 200, logIndex: 3,
      transactionHash: '0x' + '11'.repeat(32), transactionIndex: 4,
      strategy, gain: '1', loss: '0', debtPaid: '2', totalGain: '1', totalLoss: '0', totalDebt: '5', debtAdded: '0', debtRatio: '100'
    }
    const log = mapEnvioRow(row, event, 1, vault)
    expect(log.eventName).to.equal('StrategyReported')
    expect(log.args.gain).to.equal(1n)
    expect(log.args.debtPaid).to.equal(2n)
    expect(log.args.strategy).to.equal(getAddress(strategy))
    expect(log.topics[0]).to.equal(toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 debtPaid, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)'))
    expect(log.topics[1]).to.equal(pad(getAddress(strategy), { size: 32 }))
    expect(log.address).to.equal(getAddress(vault))
    expect(log.blockNumber).to.equal(100n)
    expect(log.blockTime).to.equal(200n)
    expect(() => EvmLogSchema.parse(log)).not.to.throw()
  })

  it('names the row when tx fields are missing', function() {
    const event = abi.find((e: any) => e.name === 'Transfer')
    expect(() => mapEnvioRow({ blockNumber: 100, logIndex: 0 }, event, 1, '0x0000000000000000000000000000000000000002'))
      .to.throw('Envio row missing tx fields: Transfer')
  })

  it('uses the envio chain flag', function() {
    const previous = { use: process.env.USE_ENVIO, chains: process.env.ENVIO_CHAINS }
    try {
      process.env.USE_ENVIO = ' TRUE '
      process.env.ENVIO_CHAINS = '1, 137'
      expect(useEnvio(1)).to.equal(true)
      expect(useEnvio(10)).to.equal(false)
      process.env.USE_ENVIO = 'false'
      expect(useEnvio(1)).to.equal(false)
    } finally {
      if (previous.use === undefined) delete process.env.USE_ENVIO
      else process.env.USE_ENVIO = previous.use
      if (previous.chains === undefined) delete process.env.ENVIO_CHAINS
      else process.env.ENVIO_CHAINS = previous.chains
    }
  })
})
