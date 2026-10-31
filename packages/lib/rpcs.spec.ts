import { expect } from 'chai'
import { rpcBatchOptions } from './rpcs'

describe('RPC HTTP batch settings', function() {
  it('preserves viem batching defaults when settings are absent', function() {
    expect(rpcBatchOptions({})).to.deep.equal({ batchSize: 0, wait: 0 })
    expect(rpcBatchOptions({ RPC_BATCH_WAIT_MS: '100' })).to.deep.equal({ batchSize: 0, wait: 0 })
  })

  it('accepts bounded opt-in batch sizes and wait times', function() {
    expect(rpcBatchOptions({ RPC_BATCH_SIZE: '25', RPC_BATCH_WAIT_MS: '10' }))
      .to.deep.equal({ batchSize: 25, wait: 10 })
    expect(rpcBatchOptions({ RPC_BATCH_SIZE: '100', RPC_BATCH_WAIT_MS: '100' }))
      .to.deep.equal({ batchSize: 100, wait: 100 })
  })

  it('falls back to singleton batches for unsafe or invalid settings', function() {
    for (const value of ['-1', '101', '1.5', '1e2', 'nope']) {
      expect(rpcBatchOptions({ RPC_BATCH_SIZE: value, RPC_BATCH_WAIT_MS: value }))
        .to.deep.equal({ batchSize: 0, wait: 0 })
    }
  })
})
