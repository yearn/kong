import { expect } from 'chai'
import { toEventSelector, type Address } from 'viem'
import { rpcs } from '../../../../../rpcs'
import * as prices from '../../../../../prices'
import process, { extractComposition, extractDebts } from './hook'
import db, { toUpsertSql } from '../../../../../db'

describe('abis/yearn/3/vault/snapshot/hook', function() {
  it('uses one latest series_time for strategy performance components', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x1000000000000000000000000000000000000001'
    const strategy = '0x2000000000000000000000000000000000000002' as `0x${string}`
    const latest = BigInt(Math.floor(Date.now() / 1000))
    const stale = latest - 24n * 60n * 60n

    const outputs = [
      { component: 'net', value: 0.1, blockTime: stale, seriesTime: stale },
      { component: 'weeklyNet', value: 0.2, blockTime: latest, seriesTime: latest }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label: 'apy-bwd-delta-pps',
        component: output.component,
        value: output.value,
        block_number: output.blockTime,
        block_time: Number(output.blockTime),
        series_time: Number(output.seriesTime)
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const debts = [{
      strategy,
      activation: 0n,
      lastReport: 0n,
      currentDebt: 1n,
      currentDebtUsd: 1,
      maxDebt: 1n,
      maxDebtUsd: 1,
      performanceFee: 0n,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0,
      targetDebtRatio: null,
      maxDebtRatio: null
    }]

    try {
      const composition = await extractComposition(chainId, vault, [strategy], debts)

      expect(composition).to.have.length(1)
      expect(composition[0].performance?.historical?.weeklyNet).to.equal(0.2)
      expect(composition[0].performance?.historical?.net).to.equal(undefined)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses composition when estimated apr rows have only netAPR/netAPY components', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x3000000000000000000000000000000000000003'
    const strategy = '0x4000000000000000000000000000000000000004' as `0x${string}`
    const latest = Math.floor(Date.now() / 1000)

    const outputs = [
      { component: 'netAPR', value: 0.03 },
      { component: 'netAPY', value: 0.031 }
    ]

    for (const output of outputs) {
      const outputData = {
        chain_id: chainId,
        address: strategy,
        label: 'katana-estimated-apr',
        component: output.component,
        value: output.value,
        block_number: latest,
        block_time: latest,
        series_time: latest
      }
      await db.query(toUpsertSql('output', 'chain_id, address, label, component, series_time', outputData), Object.values(outputData))
    }

    const debts = [{
      strategy,
      activation: 0n,
      lastReport: 0n,
      currentDebt: 1n,
      currentDebtUsd: 1,
      maxDebt: 1n,
      maxDebtUsd: 1,
      performanceFee: 0n,
      totalGain: 0n,
      totalGainUsd: 0,
      totalLoss: 0n,
      totalLossUsd: 0,
      targetDebtRatio: null,
      maxDebtRatio: null
    }]

    try {
      const composition = await extractComposition(chainId, vault, [strategy], debts, 'katana-estimated-apr')

      expect(composition).to.have.length(1)
      expect(composition[0].performance?.estimated?.type).to.equal('katana-estimated-apr')
      expect(composition[0].performance?.estimated?.apr).to.equal(0.03)
      expect(composition[0].performance?.estimated?.apy).to.equal(0.031)
      expect(composition[0].performance?.estimated?.components).to.deep.equal({})
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('echoes snapshot pricePerShare to override stale hook keys', async function() {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      json: async () => []
    })) as unknown as typeof fetch

    const chainId = 1337
    const vault = '0x5000000000000000000000000000000000000005'
    const asset = '0x6000000000000000000000000000000000000006'
    const pricePerShare = 1021955n
    const readContract = vi.fn().mockResolvedValue(0)
    vi.spyOn(rpcs, 'next').mockReturnValue({ readContract } as never)
    const assetData = {
      chain_id: chainId,
      address: asset,
      label: 'erc20',
      defaults: { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
    }
    await db.query(toUpsertSql('thing', 'chain_id, address, label', assetData), Object.values(assetData))

    try {
      const composition = await extractComposition(chainId, vault, [], [])
      const hook = await process(chainId, vault, { asset, pricePerShare, blockNumber: 123n, role_manager: '0x0000000000000000000000000000000000000000' })

      expect(composition).to.have.length(0)
      expect(hook.pricePerShare).to.equal(pricePerShare)
      expect(hook.allocator).to.equal(null)
      expect(readContract.mock.calls.map(([call]) => call.functionName)).not.to.include('getDebtAllocator')
    } finally {
      vi.restoreAllMocks()
      globalThis.fetch = originalFetch
    }
  })

  it('uses the manager assignment despite a forged deployment and never falls back on RPC failure', async function() {
    const chainId = 1337
    const vault = '0x1000000000000000000000000000000000000476'
    const asset = '0x2000000000000000000000000000000000000476'
    const manager = '0x4000000000000000000000000000000000000476'
    const assigned = '0x5000000000000000000000000000000000000476'
    const forged = '0x6000000000000000000000000000000000000476'
    const emitter = '0x7000000000000000000000000000000000000476'
    const signature = toEventSelector('event NewDebtAllocator(address indexed allocator, address indexed vault)')
    const readContract = vi.fn(async ({ address }: { address: Address }) => address === manager ? assigned : 0)
    vi.spyOn(rpcs, 'next').mockReturnValue({ readContract } as never)
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [] })))
    try {
      await db.query('INSERT INTO thing (chain_id,address,label,defaults) VALUES ($1,$2,\'erc20\',$3)',
        [chainId, asset, { name: 'Fixture USD', symbol: 'USD', decimals: 18 }])
      await db.query(`INSERT INTO evmlog
        (chain_id,address,event_name,signature,topics,args,block_number,log_index,transaction_hash,transaction_index)
        VALUES ($1,$2,'NewDebtAllocator',$3,$4,$5,999,0,$6,0)`,
      [chainId, emitter, signature, [signature], { allocator: forged, vault }, `0x${'0'.repeat(60)}0476`])
      const snapshot = { asset, role_manager: manager, blockNumber: 1000n }
      const hook = await process(chainId, vault, snapshot)
      expect(hook.allocator).to.equal(assigned)
      expect(readContract.mock.calls[0][0]).to.include({ address: manager, blockNumber: 1000n })
      expect(readContract.mock.calls.map(([call]) => call.address)).not.to.include(forged)

      readContract.mockRejectedValueOnce(new Error('Manager RPC unavailable'))
      let failure: unknown
      try { await process(chainId, vault, snapshot) } catch (error) { failure = error }
      expect(failure).to.be.instanceOf(Error)
      expect((failure as Error).message).to.equal('Manager RPC unavailable')
      expect(readContract.mock.calls.map(([call]) => call.address)).not.to.include(forged)
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      await db.query('DELETE FROM evmlog WHERE chain_id=$1 AND address=$2', [chainId, emitter])
      await db.query('DELETE FROM thing WHERE chain_id=$1 AND address=$2', [chainId, asset])
    }
  })

  it('reads debt and performance fees at the ratio snapshot block', async function() {
    const chainId = 1
    const vault = '0x1000000000000000000000000000000000000472'
    const asset = '0x2000000000000000000000000000000000000472'
    const strategy = '0xAbCdEf0000000000000000000000000000000472' as Address
    const blockNumber = 1000n
    const multicall = vi.fn(async (args: { blockNumber?: bigint }) => [
      { status: 'success', result: [1n, 2n, args.blockNumber === blockNumber ? 3n : 99n, 4n] },
      { status: 'success', result: 100 }
    ])
    const next = vi.spyOn(rpcs, 'next').mockReturnValue({ multicall } as never)
    vi.spyOn(prices, 'fetchErc20PriceUsd').mockResolvedValue({ priceUsd: 1 } as never)
    try {
      await db.query('INSERT INTO snapshot (chain_id,address,snapshot,hook,block_number) VALUES ($1,$2,$3,\'{}\',1000)',
        [chainId, vault, { asset, decimals: 18 }])
      const debts = await extractDebts(chainId, vault, [strategy], {
        address: '0x5000000000000000000000000000000000000472',
        ratios: { [strategy.toLowerCase()]: { targetDebtRatio: 250, maxDebtRatio: 500 } }
      }, blockNumber)
      expect(next.mock.calls).to.deep.equal([[chainId, blockNumber]])
      expect(multicall.mock.calls[0][0].blockNumber).to.equal(blockNumber)
      expect(debts[0]).to.include({ currentDebt: 3n, performanceFee: 100n, targetDebtRatio: 250, maxDebtRatio: 500 })
    } finally {
      vi.restoreAllMocks()
      await db.query('DELETE FROM snapshot WHERE chain_id=$1 AND address=$2', [chainId, vault])
    }
  })

})
