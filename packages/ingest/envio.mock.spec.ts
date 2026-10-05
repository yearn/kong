import { expect } from 'chai'
import { beforeEach, afterEach, expect as vexpect, vi } from 'vitest'
import { getAddress, pad, parseAbi, toEventSelector } from 'viem'
import { EvmLogSchema } from 'lib/types'
import abi from './abis/yearn/2/vault/abi'
import { fetchEnvioLogs, isEnvioSourceCovered, mapEnvioRow, partitionEnvioEvents, useEnvio } from './envio'

vi.mock('lib/cache', () => ({ cache: { wrap: async (_key: string, fn: () => Promise<unknown>) => fn() } }))

describe('envio', function() {
  beforeEach(() => vi.stubEnv('ENVIO_CONFIRMED_SOURCES', '[]'))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('requires confirmed source history, including its earliest indexed block', () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    const address = '0x0000000000000000000000000000000000000002'
    expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', 100n)).to.equal(false)
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ chainId: 1, address, abiPath: 'yearn/2/vault', fromBlock: '100' }]))
    expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', 100n)).to.equal(true)
    expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', 99n)).to.equal(false)
    expect(isEnvioSourceCovered(1, address, 'yearn/3/vault', 100n)).to.equal(false)
  })

  it('parses a confirmed-source list once across repeated job lookups', () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    const address = '0x0000000000000000000000000000000000000003'
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ chainId: 1, address, abiPath: 'yearn/2/vault', fromBlock: '1' }]))
    const parse = vi.spyOn(JSON, 'parse')
    try {
      for (let i = 0; i < 100; i++) expect(isEnvioSourceCovered(1, address, 'yearn/2/vault', 100n)).to.equal(true)
      expect(parse.mock.calls).to.have.length(1)
    } finally {
      parse.mockRestore()
    }
  })

  it('uses the latest start block for duplicate coverage entries', () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    const source = { chainId: 1, address: '0x0000000000000000000000000000000000000004', abiPath: 'yearn/2/vault' }
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ ...source, fromBlock: '1' }, { ...source, fromBlock: '100' }]))
    expect(isEnvioSourceCovered(1, source.address as `0x${string}`, source.abiPath, 99n)).to.equal(false)
    expect(isEnvioSourceCovered(1, source.address as `0x${string}`, source.abiPath, 100n)).to.equal(true)
  })

  it('continues rejecting malformed coverage after a valid list was cached', () => {
    vi.stubEnv('USE_ENVIO', 'true')
    vi.stubEnv('ENVIO_CHAINS', '1')
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', '[{"invalid":true}]')
    expect(() => isEnvioSourceCovered(1, '0x0000000000000000000000000000000000000003', 'yearn/2/vault', 100n)).to.throw()
  })

  it('keeps unmapped events for RPC instead of silently discarding them', () => {
    const events = parseAbi(['event StrategyChanged(address indexed strategy, uint256 change_type)', 'event UpdateRoleManager(address indexed role_manager)'])
    const { mapped, unmapped } = partitionEnvioEvents('yearn/3/vault', events)
    expect(mapped.map(event => event.name)).to.deep.equal(['StrategyChanged'])
    expect(unmapped.map(event => event.name)).to.deep.equal(['UpdateRoleManager'])
  })

  it('rejects malformed entity responses instead of treating them as empty coverage', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { chain_metadata: [{ chain_id: 1, latest_processed_block: 100 }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) }))
    const events = parseAbi(['event StrategyChanged(address indexed strategy, uint256 change_type)'])
    await vexpect(fetchEnvioLogs(1, '0x0000000000000000000000000000000000000002', 1n, 100n, events, 'yearn/3/vault'))
      .rejects.toThrow('Envio response missing entity: StrategyChanged')
  })

  it('uses verified metadata fields and a case-insensitive address filter', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { chain_metadata: [{ chain_id: 1, latest_processed_block: 100 }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { StrategyChanged: [] } }) })
    vi.stubGlobal('fetch', request)
    const events = parseAbi(['event StrategyChanged(address indexed strategy, uint256 change_type)'])
    await fetchEnvioLogs(1, '0x0eD92e4225126578791303BF579F2853e7Fdca6B', 1n, 100n, events, 'yearn/3/vault')
    const metadata = JSON.parse(request.mock.calls[0][1].body)
    const entity = JSON.parse(request.mock.calls[1][1].body)
    expect(metadata.query).to.include('chain_metadata')
    expect(metadata.query).to.include('latest_processed_block')
    expect(entity.query).to.include('vaultAddress: { _ilike: $address }')
  })

  it('rejects a missing numeric argument rather than converting null to zero', () => {
    const event = parseAbi(['event Changed(uint256 value)'])[0]
    expect(() => mapEnvioRow({ blockNumber: 1, blockTimestamp: 1, transactionHash: '0x01', transactionIndex: 0, value: null }, event, 1,
      '0x0000000000000000000000000000000000000002')).to.throw('missing uint256 argument')
  })

  it('rejects missing block metadata rather than converting null to zero', () => {
    const event = parseAbi(['event Changed(uint256 value)'])[0]
    expect(() => mapEnvioRow({ blockNumber: null, blockTimestamp: null, value: 1 }, event, 1,
      '0x0000000000000000000000000000000000000002')).to.throw('missing block fields')
  })
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
    expect(() => mapEnvioRow({ blockNumber: 100, blockTimestamp: 200, logIndex: 0 }, event, 1, '0x0000000000000000000000000000000000000002'))
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
