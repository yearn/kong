import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/app/api/db', () => ({ default: { query } }))
import allocator from './allocator'
import vault from './vault'
import { mergeSnapshot } from '@/lib/mergeSnapshot'

const address = '0xbe53a109b494e5c9f97b9cd39fe969be68bf6204'
const assigned = '0x1e9eB053228B1156831759401dE0E115356b8671'

beforeEach(() => { query.mockReset() })
describe('existing allocator GraphQL queries', () => {
  it.each([assigned, null])('uses the saved address and revision for both paths: %s', async selected => {
    const hook = { allocator: 'wrong-factory', allocatorState: { schemaVersion: 1, address: selected,
      status: selected ? 'assigned' : 'cleared', revision: 'same-revision', asOfBlock: 20987762,
      stale: true, lastAttemptAt: '2026-09-09T00:00:00Z', lastError: 'assignment_evidence_unavailable' } }
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(params).toEqual(expect.arrayContaining([1, getAddress(address)]))
      expect(sql).not.toContain('evmlog')
      return { rows: sql.includes(' AS merged') ? [{ chain_id: 1, address: getAddress(address), merged: mergeSnapshot({}, {}, hook) }] : [{ hook }] }
    })
    const [a, v] = await Promise.all([allocator({}, { chainId: 1, vault: address }), vault({}, { chainId: 1, address })])
    expect(a).toMatchObject({ chainId: 1, vault: getAddress(address), address: selected, state: { revision: 'same-revision', stale: true, lastError: 'assignment_evidence_unavailable' } })
    expect(v).toMatchObject({ allocator: selected, allocatorState: { revision: 'same-revision', stale: true, lastError: 'assignment_evidence_unavailable' } })
  })
  it('returns explicit unavailable metadata before migration instead of a factory', async () => {
    query.mockResolvedValue({ rows: [{ hook: { allocator: 'wrong-factory' } }] })
    expect(await allocator({}, { chainId: 1, vault: address })).toMatchObject({ address: null, state: { status: 'unavailable', reason: 'not_materialized' } })
  })
})
