import { strict as assert } from 'node:assert'
import { beforeEach, describe, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('@/app/api/db', () => ({
  default: { query }
}))

describe('projects resolver', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('selects only the used values and maps them to the same shape', async () => {
    query.mockResolvedValueOnce({
      rows: [{ chain_id: 1, project: { id: '0xp', name: 'Yearn' }, role_manager_factory: '0xf', governance: '0xg' }]
    })
    const { default: projects } = await import('./projects')
    const result = await projects({}, { chainId: 1 })
    const sql = query.mock.calls[0][0] as string
    assert.match(sql, /snapshot\.hook->'project' AS project/)
    assert.equal(/thing\.defaults,|snapshot\.hook,|snapshot\.snapshot,/.test(sql), false)
    assert.deepEqual(query.mock.calls[0][1], ['roleManager', 1])
    assert.deepEqual(result, [{ chainId: 1, id: '0xp', name: 'Yearn', roleManagerFactory: '0xf', governance: '0xg' }])
  })

  it('tolerates a missing project', async () => {
    query.mockResolvedValueOnce({ rows: [{ chain_id: 1, project: null, role_manager_factory: null, governance: null }] })
    const { default: projects } = await import('./projects')
    const result = await projects({}, {})
    assert.deepEqual(result, [{ chainId: 1, roleManagerFactory: null, governance: null }])
  })
})
