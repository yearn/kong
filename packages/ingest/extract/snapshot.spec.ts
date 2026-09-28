import { expect } from 'chai'
import { mq } from 'lib'
import * as blocks from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import { createPublicClient, custom, encodeFunctionResult, parseAbi, zeroAddress, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import abiutil from '../abiutil'
import { readVaultAllocator } from '../abis/yearn/lib/allocator'
import { SnapshotExtractor } from './snapshot'
import vaultHook from '../abis/yearn/3/vault/snapshot/hook'
import db from '../db'

const ADDRESS = '0x696d02db93291651ed510704c9b286841d506987' as `0x${string}`

describe('SnapshotExtractor', function() {
  it('stores the Yearn v3 pricePerShare returned by the snapshot multicall', async function() {
    const fields = [
      { type: 'function', stateMutability: 'view', name: 'pricePerShare', inputs: [], outputs: [] },
      { type: 'function', stateMutability: 'view', name: 'totalAssets', inputs: [], outputs: [] }
    ]
    const block = { chainId: 1, number: 123n, timestamp: 456n }
    const multicall = vi.fn().mockResolvedValue([
      { result: 1021955n },
      { result: 900n }
    ])
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)
    vi.spyOn(abiutil, 'load').mockResolvedValue(fields)
    vi.spyOn(abiutil, 'fields').mockReturnValue(fields)
    vi.spyOn(blocks, 'getBlock').mockResolvedValue(block)
    vi.spyOn(rpcs, 'next').mockReturnValue({ multicall } as never)

    try {
      const extractor = new SnapshotExtractor()
      extractor.resolveHooks = () => []
      await extractor.extract({
        abi: { abiPath: 'yearn/3/vault', sources: [], skip: false, only: false },
        source: { chainId: 1, address: ADDRESS, inceptBlock: 0n, skip: false, only: false }
      })

      expect(add.mock.calls).to.have.length(1)
      const [job, payload] = add.mock.calls[0] as [unknown, {
        snapshot: Record<string, unknown>
        hook: Record<string, unknown>
      }]
      expect(job).to.equal(mq.job.load.snapshot)
      expect(payload.snapshot).to.include({
        blockNumber: 123n,
        blockTime: 456n,
        pricePerShare: 1021955n,
        totalAssets: 900n
      })
      expect(payload.hook).to.deep.equal({})
    } finally {
      vi.restoreAllMocks()
    }
  })
  it.each([undefined, -32603])('does not enqueue a snapshot when its required allocator read fails with RPC code %s', async function(code) {
    vi.spyOn(abiutil, 'load').mockResolvedValue([])
    vi.spyOn(abiutil, 'fields').mockReturnValue([])
    vi.spyOn(blocks, 'getBlock').mockResolvedValue({ chainId: 1, number: 123n, timestamp: 456n })
    vi.spyOn(rpcs, 'next').mockReturnValue({ multicall: vi.fn().mockResolvedValue([]) } as never)
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)
    const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => {
      throw Object.assign(new Error('Allocator RPC unavailable'), { code })
    } }, { retryCount: 0 }) })
    const extractor = new SnapshotExtractor()
    extractor.resolveHooks = () => [{ module: { default: async () =>
      readVaultAllocator(ADDRESS, '0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41', [], 123n, client)
    } }] as never
    try {
      let failure: unknown
      try { await extractor.extract({
        abi: { abiPath: 'yearn/3/vault', sources: [], skip: false, only: false },
        source: { chainId: 1, address: ADDRESS, inceptBlock: 0n, skip: false, only: false }
      }) } catch (error) { failure = error }
      expect(failure).to.be.instanceOf(Error)
      expect((failure as Error).message).to.include('Allocator RPC unavailable')
      expect(add.mock.calls).to.have.length(0)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it.each(['empty', 'revert', 'recover', 'zero', 'transport', 'internal', 'internal-empty'] as const)(
    'handles a missing role_manager through extraction and the vault hook: %s', async function(mode) {
      const vault = '0x1000000000000000000000000000000000000532' as Address
      const asset = '0x2000000000000000000000000000000000000532'
      const manager = '0x3000000000000000000000000000000000000532'
      const assigned = '0x4000000000000000000000000000000000000532'
      const block = { chainId: 1, number: 123n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }
      const abi = parseAbi([
        'function role_manager() view returns (address)', 'function asset() view returns (address)',
        'function decimals() view returns (uint8)', 'function apiVersion() view returns (string)',
        'function pricePerShare() view returns (uint256)', 'function totalAssets() view returns (uint256)'
      ])
      const values: Record<string, unknown> = { asset, decimals: 6, apiVersion: '3.0.4', pricePerShare: 1232381n, totalAssets: 120000000n }
      const confirmation = createPublicClient({ chain: mainnet, transport: custom({ request: async () => {
        if (mode === 'empty') return '0x'
        if (mode === 'revert') throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x' })
        if (mode === 'transport') throw new Error('RPC unavailable')
        if (mode === 'internal' || mode === 'internal-empty') {
          throw Object.assign(new Error('Internal error'), { code: -32603, data: mode === 'internal-empty' ? '0x' : undefined })
        }
        return encodeFunctionResult({ abi, functionName: 'role_manager', result: mode === 'zero' ? zeroAddress : manager })
      } }, { retryCount: 0 }) })
      const readContract = vi.fn(async (call: { address: Address; functionName: string; blockNumber?: bigint }) => {
        if (call.address === vault && call.functionName === 'role_manager') {
          return confirmation.readContract({ address: vault, abi, functionName: 'role_manager', blockNumber: call.blockNumber })
        }
        if (call.address === manager && call.functionName === 'getDebtAllocator') return assigned
        if (call.address === vault && call.functionName === 'performanceFee') return 100
        throw new Error(`Unexpected read: ${call.functionName}`)
      })
      const multicall = vi.fn(async ({ contracts }: { contracts: { functionName: string }[] }) => contracts.map(call =>
        call.functionName === 'role_manager'
          ? { status: 'failure', error: new Error('No manager value in initial multicall') }
          : { status: 'success', result: values[call.functionName] }
      ))
      vi.spyOn(rpcs, 'next').mockReturnValue({ readContract, multicall } as never)
      vi.spyOn(blocks, 'getBlock').mockResolvedValue(block)
      vi.spyOn(abiutil, 'load').mockResolvedValue(abi)
      vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => [] })))
      const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)
      const extractor = new SnapshotExtractor()
      extractor.resolveHooks = () => [{ abiPath: 'yearn/3/vault', type: 'snapshot', module: { default: vaultHook } }]
      try {
        await db.query('INSERT INTO thing (chain_id,address,label,defaults) VALUES (1,$1,\'erc20\',$2)',
          [asset, { name: 'Fixture USD', symbol: 'USD', decimals: 6 }])
        await db.query('INSERT INTO snapshot (chain_id,address,snapshot,hook,block_number) VALUES (1,$1,$2,$3,1)',
          [vault, { asset, decimals: 6 }, { allocator: assigned, pricePerShare: '1000000', tvl: { close: 10 }, apy: { net: 0.01 } }])
        await db.query(`INSERT INTO output (chain_id,address,label,component,value,block_number,block_time,series_time)
          VALUES (1,$1,'tvl-c','tvl',120,123,to_timestamp($2),to_timestamp($2)),
                 (1,$1,'apy-bwd-delta-pps','net',0.05,123,to_timestamp($2),to_timestamp($2))`, [vault, Number(block.timestamp)])
        const run = extractor.extract({
          abi: { abiPath: 'yearn/3/vault', sources: [], skip: false, only: false },
          source: { chainId: 1, address: vault, inceptBlock: 0n, skip: false, only: false }
        })
        if (mode === 'transport' || mode === 'internal' || mode === 'internal-empty') {
          let failure: unknown
          try { await run } catch (error) { failure = error }
          expect(failure).to.be.instanceOf(Error)
          expect((failure as Error).message).to.include(mode === 'transport' ? 'RPC unavailable' : 'Internal error')
          expect(add.mock.calls).to.have.length(0)
        } else {
          await run
          expect(add.mock.calls).to.have.length(1)
          const [job, payload] = add.mock.calls[0] as [unknown, { snapshot: Record<string, unknown>; hook: {
            allocator: unknown; tvl: { close: number }; apy: { net: number }; pricePerShare: bigint; fees: { performanceFee: number }
          } }]
          expect(job).to.equal(mq.job.load.snapshot)
          expect(payload.snapshot).to.include({ pricePerShare: 1232381n, totalAssets: 120000000n, blockNumber: 123n })
          expect(payload.hook.allocator).to.equal(mode === 'recover' ? assigned : null)
          expect(payload.hook.tvl.close).to.equal(120)
          expect(payload.hook.apy.net).to.equal(0.05)
          expect(payload.hook.pricePerShare).to.equal(1232381n)
          expect(payload.hook.fees.performanceFee).to.equal(100)
          expect(payload.snapshot.role_manager).to.equal(mode === 'recover' ? manager : mode === 'zero' ? zeroAddress : undefined)
        }
        expect(readContract.mock.calls.filter(([call]) => call.functionName === 'role_manager')).to.have.length(1)
        expect(readContract.mock.calls[0][0]).to.include({ address: vault, blockNumber: 123n })
        const assignments = readContract.mock.calls.filter(([call]) => call.functionName === 'getDebtAllocator')
        expect(assignments).to.have.length(mode === 'recover' ? 1 : 0)
        if (mode === 'recover') expect(assignments[0][0]).to.include({ address: manager, blockNumber: 123n })
      } finally {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        await db.query('DELETE FROM output WHERE chain_id=1 AND address=$1', [vault])
        await db.query('DELETE FROM snapshot WHERE chain_id=1 AND address=$1', [vault])
        await db.query('DELETE FROM thing WHERE chain_id=1 AND address=$1', [asset])
      }
    })

})
