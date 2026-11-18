import { beforeEach, describe, expect, it, vi } from 'vitest'

const { add, getBlock, hooks, loadAbi, next, fields } = vi.hoisted(() => {
  const hooks = vi.fn(() => [{ module: { default: vi.fn(async () => ({ derived: 1 })) } }])
  return {
    add: vi.fn(async () => undefined),
    getBlock: vi.fn(async () => ({ chainId: 1, number: 123n, timestamp: 456n })),
    hooks,
    loadAbi: vi.fn(async () => []),
    next: vi.fn(),
    fields: vi.fn(() => [])
  }
})

vi.mock('lib', () => ({ mq: { add, job: { load: { snapshot: 'load:snapshot' } } } }))
vi.mock('lib/rpcs', () => ({ rpcs: { next } }))
vi.mock('lib/blocks', () => ({ getBlock }))
vi.mock('../abis', () => ({ requireHooks: vi.fn(async () => hooks) }))
vi.mock('../abiutil', () => ({ default: { load: loadAbi, fields } }))

import { SnapshotExtractor } from './snapshot'

describe('SnapshotExtractor with no snapshot fields', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the timestamped empty snapshot and skips multicall', async () => {
    const extractor = new SnapshotExtractor()
    await extractor.extract({
      abi: { abiPath: 'test', sources: [], skip: false, only: false },
      source: { chainId: 1, address: '0x1111111111111111111111111111111111111111', inceptBlock: 0n, skip: false, only: false }
    })

    expect(next).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith('load:snapshot', {
      chainId: 1,
      address: '0x1111111111111111111111111111111111111111',
      snapshot: { blockNumber: 123n, blockTime: 456n },
      hook: { derived: 1 },
      blockNumber: 123n,
      blockTime: 456n
    })
  })
})
