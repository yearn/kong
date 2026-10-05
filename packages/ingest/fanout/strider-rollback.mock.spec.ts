import { describe, expect, it } from 'vitest'
import { rollback } from 'lib/strider'

describe('fragmented coverage rollback', () => {
  const coverage = [{ from: 19_000_000n, to: 23_000_000n }, { from: 23_700_000n, to: 23_900_000n }]
  it('drops coverage starting beyond a target in a gap', () => {
    expect(rollback(coverage, 23_657_375n)).toEqual([coverage[0]])
  })
  it('truncates an earlier stride and drops all later ranges', () => {
    expect(rollback(coverage, 22_000_000n)).toEqual([{ from: 19_000_000n, to: 22_000_000n }])
  })
  it('returns no range before inception and retains the exact target endpoint', () => {
    expect(rollback(coverage, 18_000_000n)).toEqual([])
    expect(rollback(coverage, 23_700_000n)).toEqual([coverage[0], { from: 23_700_000n, to: 23_700_000n }])
    expect(coverage[1].to).toBe(23_900_000n)
  })
})
