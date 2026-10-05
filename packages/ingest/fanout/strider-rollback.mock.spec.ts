import { describe, expect, it } from 'vitest'
import { rollback } from 'lib/strider'

describe('fragmented coverage rollback', () => {
  const coverage = [{ from: 19_000_000n, to: 23_000_000n }, { from: 23_700_000n, to: 23_900_000n }]
  it.each([
    { coverage: [{ from: '18097341', to: '150000000' }], target: 142915777n, from: 18097341n },
    { coverage: [{ from: '4841854', to: '400000000' }], target: 393385831n, from: 4841854n },
    { coverage: [{ from: '9000000', to: '120000000' }], target: 117399886n, from: 9000000n }
  ])('coerces persisted string endpoints before numeric truncation: %j', ({ coverage, target, from }) => {
    expect(rollback(JSON.parse(JSON.stringify(coverage)), target)).toEqual([{ from, to: target }])
  })
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
