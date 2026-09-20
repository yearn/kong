import { expect } from 'chai'
import { getAddress, pad, toEventSelector } from 'viem'
import { EvmLogSchema } from 'lib/types'
import abi from './abis/yearn/2/vault/abi'
import { mapEnvioRow, useEnvio } from './envio'

describe('envio', function() {
  it('maps an aliased overloaded event', function() {
    const strategy = '0x0000000000000000000000000000000000000001'
    const row = {
      event_name: 'StrategyReportedLegacy',
      block_number: '100',
      block_timestamp: '200',
      log_index: 3,
      src_address: '0x0000000000000000000000000000000000000002',
      transaction_fields: { hash: '0x' + '11'.repeat(32), transactionIndex: 4 },
      params: { strategy, gain: '1', loss: '0', totalGain: '1', totalLoss: '0', totalDebt: '5', debtAdded: '0', debtRatio: '100' }
    }
    const log = mapEnvioRow(row, abi, 1)
    expect(log.eventName).to.equal('StrategyReported')
    expect(log.args.gain).to.equal(1n)
    expect(log.args.strategy).to.equal(getAddress(strategy))
    expect(log.topics[0]).to.equal(toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)'))
    expect(log.topics[1]).to.equal(pad(getAddress(strategy), { size: 32 }))
    expect(log.address).to.equal(getAddress(row.src_address))
    expect(log.blockNumber).to.equal(100n)
    expect(log.blockTime).to.equal(200n)
    expect(() => EvmLogSchema.parse(log)).not.to.throw()
  })

  it('maps integer values for non-overloaded events', function() {
    const row = {
      event_name: 'Transfer',
      block_number: '100',
      block_timestamp: '200',
      log_index: 0,
      src_address: '0x0000000000000000000000000000000000000002',
      transaction_fields: { hash: '0x' + '22'.repeat(32), transactionIndex: 0 },
      params: { sender: '0x0000000000000000000000000000000000000001', receiver: '0x0000000000000000000000000000000000000002', value: '7' }
    }
    const log = mapEnvioRow(row, abi, 1)
    expect(log.args.value).to.equal(7n)
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
