import { expect } from 'chai'
import { mq } from 'lib'
import * as blocks from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import { createPublicClient, custom } from 'viem'
import { mainnet } from 'viem/chains'
import abiutil from '../abiutil'
import { readVaultAllocator } from '../abis/yearn/lib/allocator'
import { SnapshotExtractor } from './snapshot'

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

})
