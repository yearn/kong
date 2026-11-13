import { describe, expect, it, vi } from 'vitest'

const poolModuleLoaded = vi.hoisted(() => vi.fn())
vi.mock('../../web/app/api/db/index.ts', () => {
  poolModuleLoaded()
  return { default: { query: vi.fn() } }
})

import { getVaultsWithSnapshots } from '../../web/app/api/rest/list/db'

describe('injected source pool', () => {
  it('does not initialize the web pool when the helper is imported or called with a pool', async () => {
    expect(poolModuleLoaded).not.toHaveBeenCalled()
    const sourceDb = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await getVaultsWithSnapshots(sourceDb as never)

    expect(sourceDb.query).toHaveBeenCalledOnce()
    expect(poolModuleLoaded).not.toHaveBeenCalled()
  })
})
