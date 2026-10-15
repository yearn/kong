import { expect } from 'chai'
import { beforeEach, afterEach, expect as vexpect, vi } from 'vitest'
import { getAddress, pad, parseAbi, toEventSelector } from 'viem'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import abiutil from './abiutil'
import { EvmLogSchema } from 'lib/types'
import abi from './abis/yearn/2/vault/abi'
import { fetchEnvioLogs, isEnvioSourceCovered, mapEnvioRow, partitionEnvioEvents, useEnvio, ENVIO_ENTITIES, isEnvioSourceTrusted, invalidateEnvioSource } from './envio'

const { revoked } = vi.hoisted(() => ({ revoked: new Map<string, unknown>() }))
vi.mock('lib/cache', () => ({ cache: {
  ready: true, wrap: async (_key: string, fn: () => Promise<unknown>) => fn(),
  get: async (key: string) => revoked.get(key), set: async (key: string, value: unknown) => { revoked.set(key, value) }
} }))

describe('envio', function() {
  beforeEach(() => { revoked.clear(); vi.stubEnv('ENVIO_CONFIRMED_SOURCES', '[]') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('matches every mapping and ABI input against the verified schema contract', async () => {
    const contract = JSON.parse(readFileSync(path.resolve(__dirname, '../../docs/envio-schema-contract.json'), 'utf8'))
    expect(Object.keys(ENVIO_ENTITIES).sort()).to.deep.equal(contract.mappings.map((entry: { key: string }) => entry.key).sort())
    for (const entry of contract.mappings) {
      expect(ENVIO_ENTITIES[entry.key]).to.deep.equal({ entity: entry.entity, address: entry.address })
      const [abiPath, eventName] = entry.key.split(':')
      const event = abiutil.events(await abiutil.load(abiPath)).find(event => event.name === eventName)!
      expect(event.inputs.map(input => input.name)).to.deep.equal(entry.inputs)
    }
    const unsupported = partitionEnvioEvents('yearn/2/vault', abi.filter(event => ['StrategyAdded', 'StrategyReported'].includes('name' in event ? event.name : '')))
    expect(unsupported.mapped).to.have.length(0)
    expect(contract.overloadEvidence.every((entry: { nullable: boolean, handling: string }) => !entry.nullable && entry.handling.includes('RPC'))).to.equal(true)
  })

  it('retains revocation until the same source is independently reconfirmed', async () => {
    vi.stubEnv('USE_ENVIO', 'true'); vi.stubEnv('ENVIO_CHAINS', '1')
    const source = { chainId: 1, address: '0x0000000000000000000000000000000000000002', abiPath: 'yearn/3/vault', fromBlock: '1', confirmationId: 'first' }
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([source]))
    expect(await isEnvioSourceTrusted(1, source.address as `0x${string}`, source.abiPath, 1n)).to.equal(true)
    await invalidateEnvioSource(1, source.address as `0x${string}`, source.abiPath)
    expect(await isEnvioSourceTrusted(1, source.address as `0x${string}`, source.abiPath, 2n)).to.equal(false)
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([source, { ...source, address: '0x0000000000000000000000000000000000000003' }]))
    expect(await isEnvioSourceTrusted(1, source.address as `0x${string}`, source.abiPath, 2n)).to.equal(false)
    vi.stubEnv('ENVIO_CONFIRMED_SOURCES', JSON.stringify([{ ...source, confirmationId: 'revalidated' }]))
    expect(await isEnvioSourceTrusted(1, source.address as `0x${string}`, source.abiPath, 2n)).to.equal(true)
  })

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

  it('uses verified metadata fields and an exact checksummed address filter', async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: { chain_metadata: [{ chain_id: 1, latest_processed_block: 100 }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { StrategyChanged: [] } }) })
    vi.stubGlobal('fetch', request)
    const events = parseAbi(['event StrategyChanged(address indexed strategy, uint256 change_type)'])
    await fetchEnvioLogs(1, '0x0eD92e4225126578791303BF579F2853e7Fdca6B', 1n, 100n, events, 'yearn/3/vault')
    const metadata = JSON.parse(request.mock.calls[0][1].body)
    const entity = JSON.parse(request.mock.calls[1][1].body)
    expect(metadata.query).to.include('chain_metadata')
    expect(metadata.query).to.include('latest_processed_block')
    expect(entity.query).to.include('vaultAddress: { _eq: $address }')
  })

  it('paginates one entity without skipping or duplicating rows at the cursor boundary', async () => {
    const address = '0x0000000000000000000000000000000000000002'
    const events = parseAbi(['event StrategyChanged(address indexed strategy, uint256 change_type)'])
    const row = (blockNumber: number, logIndex: number) => ({ blockNumber, logIndex, blockTimestamp: 200, transactionHash: '0x' + '11'.repeat(32), transactionIndex: 0, strategy: address, change_type: '1' })
    const firstPage = Array.from({ length: 1000 }, (_, index) => row(10, index))
    const secondPage = [row(10, 1000), row(11, 0)]
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { chain_metadata: [{ chain_id: 1, latest_processed_block: 100 }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { StrategyChanged: firstPage } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { StrategyChanged: secondPage } }) })
    vi.stubGlobal('fetch', request)
    const logs = await fetchEnvioLogs(1, address, 10n, 100n, events, 'yearn/3/vault')
    expect(JSON.parse(request.mock.calls[1][1].body).variables).to.include({ block: 10, logIndex: -1 })
    expect(JSON.parse(request.mock.calls[2][1].body).variables).to.include({ block: 10, logIndex: 999 })
    expect(logs).to.have.length(1002)
    expect(new Set(logs.map(log => `${log.blockNumber}:${log.logIndex}`)).size).to.equal(1002)
    expect(logs.map(log => [log.blockNumber, log.logIndex])).to.deep.equal([...firstPage, ...secondPage].map(row => [BigInt(row.blockNumber), row.logIndex]))
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
