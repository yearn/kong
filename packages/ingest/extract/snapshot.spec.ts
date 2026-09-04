import { expect } from 'chai'
import { mq } from 'lib'
import * as blocks from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import abiutil from '../abiutil'
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
})
