import { describe, expect, it } from 'vitest'
import { resolveSnapshotTvl } from './snapshot-tvl'

const DAY = 24 * 60 * 60
const now = 1_800_000_000
const point = (ageDays: number, close: number) => ({ close, blockTime: BigInt(now - Math.round(ageDays * DAY)) })

describe('resolveSnapshotTvl', () => {
  it('returns the newest bucket while it is recent', () => {
    const newest = point(2, 10)
    expect(resolveSnapshotTvl([newest, point(9, 5)], now)).to.equal(newest)
  })

  it('keeps a recent zero instead of an older positive bucket', () => {
    const newest = point(2, 0)
    expect(resolveSnapshotTvl([newest, point(9, 5)], now)).to.equal(newest)
  })

  it('accepts the previous weekly bucket right after the utc rollover', () => {
    const previous = point(7 + 1 / 48, 10)
    expect(resolveSnapshotTvl([previous], now)).to.equal(previous)
  })

  it('drops a stale bucket so an old valuation never reads as current', () => {
    expect(resolveSnapshotTvl([point(15, 1234.5)], now)).to.equal(null)
    expect(resolveSnapshotTvl([point(400, 1_844_476)], now)).to.equal(null)
  })

  it('returns null for an empty sparkline so a merge never keeps an older tvl', () => {
    expect(resolveSnapshotTvl([], now)).to.equal(null)
    expect(JSON.parse(JSON.stringify({ tvl: resolveSnapshotTvl([point(15, 1), point(2, 3)].slice(0, 1), now) }))).to.deep.equal({ tvl: null })
  })
})
