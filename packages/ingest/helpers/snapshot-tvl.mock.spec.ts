import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db', () => ({ default: { query } }))

import { resolveSnapshotTvl } from './snapshot-tvl'

const point = (close: number) => ({ close, blockTime: 1n })

describe('resolveSnapshotTvl', () => {
  beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [{ value: '1234.5' }] }) })

  it('returns the newest point when it is non-zero', async () => {
    expect(await resolveSnapshotTvl(1, '0x1', [point(10), point(5)], '100')).to.deep.equal(point(10))
    expect(query).not.toHaveBeenCalled()
  })

  it('falls back to the latest non-zero tvl when assets remain', async () => {
    expect((await resolveSnapshotTvl(1, '0x1', [point(0), point(5)], 100n))?.close).to.equal(1234.5)
  })

  it('keeps a genuine zero when the vault is empty or assets are unknown', async () => {
    expect((await resolveSnapshotTvl(1, '0x1', [point(0)], '0'))?.close).to.equal(0)
    expect((await resolveSnapshotTvl(1, '0x1', [point(0)], undefined))?.close).to.equal(0)
    expect(query).not.toHaveBeenCalled()
  })

  it('keeps zero when no non-zero history exists', async () => {
    query.mockResolvedValue({ rows: [] })
    expect((await resolveSnapshotTvl(1, '0x1', [point(0)], 5n))?.close).to.equal(0)
  })

  it('handles an empty sparkline', async () => {
    expect(await resolveSnapshotTvl(1, '0x1', [], 5n)).to.equal(undefined)
  })
})
