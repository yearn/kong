import { expect } from 'chai'
import { mq } from 'lib'
import * as blocks from 'lib/blocks'
import { rpcs } from '../../../../../../rpcs'
import process from './hook'

const STRATEGY = '0x111111111111111111111111111111111111111d' as `0x${string}`

function mockChain({ tokenized, apiVersion }: { tokenized: boolean, apiVersion?: string }) {
  const readContract = vi.fn()
    .mockResolvedValueOnce('0xasset000000000000000000000000000000001')
    .mockResolvedValueOnce(18)

  const successes = tokenized
    ? [{ status: 'success' }, { status: 'success' }, { status: 'success' }, { status: 'success' }, { status: 'success' }]
    : [{ status: 'failure' }, { status: 'success' }, { status: 'success' }, { status: 'success' }, { status: 'success' }]

  const apiVersionResult = apiVersion === undefined
    ? { status: 'failure' }
    : { status: 'success', result: apiVersion }

  const multicall = vi.fn().mockResolvedValue([...successes, apiVersionResult])

  vi.spyOn(rpcs, 'next').mockReturnValue({ readContract, multicall } as never)
  vi.spyOn(blocks, 'estimateCreationBlock').mockResolvedValue({ number: 1n, timestamp: 2n, chainId: 1 })
}

describe('StrategyChanged hook', function() {
  afterEach(() => vi.restoreAllMocks())

  it('merges classifyVault output into the vault thing when the probe fails but apiVersion resolves', async function() {
    mockChain({ tokenized: false, apiVersion: '3.0.2' })
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)

    await process(1, STRATEGY, {
      blockNumber: 123n,
      args: { strategy: STRATEGY }
    })

    expect(add.mock.calls).to.have.length(1)
    const [, payload] = add.mock.calls[0] as [unknown, { defaults: Record<string, unknown> }]
    expect(payload.defaults).to.include({
      yearn: true,
      v3: true,
      apiVersion: '3.0.2',
      erc4626: true
    })
  })

  it('omits yearn/v3 when the probe fails and apiVersion does not resolve', async function() {
    mockChain({ tokenized: false, apiVersion: undefined })
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)

    await process(1, STRATEGY, {
      blockNumber: 123n,
      args: { strategy: STRATEGY }
    })

    expect(add.mock.calls).to.have.length(1)
    const [, payload] = add.mock.calls[0] as [unknown, { defaults: Record<string, unknown> }]
    expect(payload.defaults).to.not.have.any.keys('yearn', 'v3')
    expect(payload.defaults).to.deep.equal({
      erc4626: true,
      asset: '0xasset000000000000000000000000000000001',
      decimals: 18,
      inceptBlock: 1n,
      inceptTime: 2n
    })
  })

  it('keeps erc4626 defaults with no yearn/v3 when the probe fails and apiVersion is garbage', async function() {
    mockChain({ tokenized: false, apiVersion: 'yVault' })
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)

    await process(1, STRATEGY, {
      blockNumber: 123n,
      args: { strategy: STRATEGY }
    })

    expect(add.mock.calls).to.have.length(1)
    const [, payload] = add.mock.calls[0] as [unknown, { defaults: Record<string, unknown> }]
    expect(payload.defaults).to.not.have.any.keys('yearn', 'v3')
    expect(payload.defaults).to.deep.equal({
      erc4626: true,
      asset: '0xasset000000000000000000000000000000001',
      decimals: 18,
      inceptBlock: 1n,
      inceptTime: 2n
    })
  })

  it('adds yearn to the vault thing on the tokenized branch alongside existing keys', async function() {
    mockChain({ tokenized: true, apiVersion: '3.0.2' })
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)

    await process(1, STRATEGY, {
      blockNumber: 123n,
      args: { strategy: STRATEGY }
    })

    expect(add.mock.calls).to.have.length(2)
    const [, strategyPayload] = add.mock.calls[0] as [unknown, { defaults: Record<string, unknown> }]
    const [, vaultPayload] = add.mock.calls[1] as [unknown, { defaults: Record<string, unknown> }]

    expect(strategyPayload.defaults).to.not.have.key('yearn')
    expect(vaultPayload.defaults).to.include({
      yearn: true,
      v3: true,
      erc4626: true,
      apiVersion: '3.0.2'
    })
  })
})
