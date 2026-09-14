import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import db from 'ingest/db'
import { rpcs } from 'ingest/rpcs'
import { projectCurrentAllocator, type CurrentAllocatorProjection } from 'ingest/abis/yearn/lib/allocators/projection'
import { updateSnapshotAllocator } from './store'

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }))
vi.mock('ingest/db', () => ({ default: database }))
vi.mock('ingest/rpcs', () => ({ rpcs: { up: vi.fn(), down: vi.fn(), next: vi.fn() } }))
vi.mock('ingest/abis/yearn/lib/allocators/projection', () => ({ projectCurrentAllocator: vi.fn() }))
vi.mock('./store', () => ({ updateSnapshotAllocator: vi.fn() }))

const vault = '0x1111111111111111111111111111111111111111'
const candidate: CurrentAllocatorProjection = {
  schemaVersion: 1, chainId: 1, vault, address: '0x2222222222222222222222222222222222222222',
  assignmentId: 'assignment', roleManagerAddress: vault, status: 'assigned', reason: null,
  family: 'shared', support: 'supported', asOfBlock: 20, deploymentSourceEventId: 'factory',
  revision: 'candidate', sourceRevision: 'fixture', blockHash: `0x${'1'.repeat(64)}`,
  observedAt: '2026-09-08T00:00:00Z', ratios: {}, evidence: { events: [], deployments: [] }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('process', { ...process, argv: ['bun', 'refresh-allocators.ts', '--chain=1', `--vault=${vault}`, '--write'], exitCode: 0 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  database.query.mockResolvedValue({ rows: [{ address: vault, hook: { strategies: [] } }] })
  vi.mocked(projectCurrentAllocator).mockResolvedValue(candidate)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function run() {
  await import('./refresh')
  await vi.waitFor(() => expect(db.end).toHaveBeenCalledOnce())
  expect(rpcs.down).toHaveBeenCalledOnce()
  expect(console.error).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(0)
  expect(console.log).toHaveBeenCalledOnce()
  return JSON.parse(vi.mocked(console.log).mock.calls[0][0])
}

describe('allocator refresh reporting', () => {
  it('reports the saved projection and skipped outcome when a delayed candidate is rejected', async () => {
    const saved: CurrentAllocatorProjection = { ...candidate, address: '0x3333333333333333333333333333333333333333',
      support: 'unsupported', revision: 'saved', asOfBlock: 21 }
    vi.mocked(updateSnapshotAllocator).mockResolvedValue({ applied: false, projection: saved })
    expect(await run()).toEqual({ chainId: 1, vault, address: saved.address, support: saved.support,
      revision: saved.revision, asOfBlock: saved.asOfBlock, outcome: 'skipped', written: false })
    expect(updateSnapshotAllocator).toHaveBeenCalledWith(1, vault, candidate)
  })

  it('reports the committed projection when the candidate is applied', async () => {
    vi.mocked(updateSnapshotAllocator).mockResolvedValue({ applied: true, projection: candidate })
    expect(await run()).toEqual({ chainId: 1, vault, address: candidate.address, support: candidate.support,
      revision: candidate.revision, asOfBlock: candidate.asOfBlock, outcome: 'applied', written: true })
    expect(updateSnapshotAllocator).toHaveBeenCalledWith(1, vault, candidate)
  })

  it('reports retained data and a stale write while failing an unavailable refresh', async () => {
    const unavailable = { ...candidate, address: null, revision: null, status: 'unavailable' as const,
      reason: 'assignment_evidence_unavailable' }
    const retained = { ...candidate, stale: true, lastError: unavailable.reason }
    vi.mocked(projectCurrentAllocator).mockResolvedValue(unavailable)
    vi.mocked(updateSnapshotAllocator).mockResolvedValue({ applied: false, staleUpdated: true, projection: retained })
    await import('./refresh')
    await vi.waitFor(() => expect(db.end).toHaveBeenCalledOnce())
    expect(rpcs.down).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({ address: candidate.address,
      revision: candidate.revision, stale: true, lastError: unavailable.reason, outcome: 'stale', written: true })
  })

  it('labels the candidate as a dry run without calling the writer', async () => {
    process.argv = process.argv.filter(value => value !== '--write')
    expect(await run()).toEqual({ chainId: 1, vault, address: candidate.address, support: candidate.support,
      revision: candidate.revision, asOfBlock: candidate.asOfBlock, outcome: 'dry_run', written: false })
    expect(updateSnapshotAllocator).not.toHaveBeenCalled()
  })
})
