import { describe, expect, it, vi } from 'vitest'
const { on, captureException } = vi.hoisted(() => ({ on: vi.fn(), captureException: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { on = on }, types: { setTypeParser: vi.fn() } }))
vi.mock('lib', () => ({ strings: {}, sentry: { captureException } }))
import { toBulkUpsertSql } from './db'

describe('database failure and guard contracts', () => {
  it('reports an idle pool error without throwing out of the event listener', () => {
    const handler = on.mock.calls.find(call => call[0] === 'error')![1]
    const error = new Error('idle connection lost')
    expect(() => handler(error)).not.toThrow()
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({ tags: { component: 'ingest', operation: 'pg.pool' } }))
  })
  it('rejects a conflict guard when there are no update columns', () => {
    expect(() => toBulkUpsertSql('example', 'id', ['id'], 1, 'WHERE false')).toThrow('conflict guard')
    expect(toBulkUpsertSql('example', 'id', ['id'], 1)).toContain('DO NOTHING')
  })
})
