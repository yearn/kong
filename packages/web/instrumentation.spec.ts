import { describe, expect, it, vi } from 'vitest'
import type { Instrumentation } from 'next'
import { withRequestDiagnostics } from './lib/request-diagnostics'

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), flush: vi.fn() }))
vi.mock('lib/sentry', () => sentry)
import { onRequestError } from './instrumentation'

const context: Parameters<Instrumentation.onRequestError>[2] = {
  routerKind: 'App Router', routePath: '/api/gql', routeType: 'route', revalidateReason: undefined
}

describe('Bugsink request error reporting', () => {
  it('captures parse-stage metadata once, sanitizes parser messages and flushes', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    sentry.captureException.mockClear()
    sentry.flush.mockClear()
    const request = new Request('https://example.com/api/gql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'private-malformed-body' })
    let caught: Error | undefined
    try { await withRequestDiagnostics(request, r => r.json()) } catch (error) { caught = error as Error }
    await onRequestError(caught!, { method: 'POST', path: '/api/gql?secret=private-query', headers: { authorization: 'Bearer private-token' } }, context)
    expect(sentry.captureException).toHaveBeenCalledOnce()
    const [error, options] = sentry.captureException.mock.calls[0]
    expect(options.tags).toMatchObject({ component: 'web', route: '/api/gql', stage: 'request.json', errorClass: 'SyntaxError' })
    expect(options.extra.path).toBe('/api/gql')
    expect(options.extra.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(options) + error.stack).not.toMatch(/private-malformed-body|private-query|private-token/)
    expect(sentry.flush).toHaveBeenCalledWith(2000)
    vi.unstubAllEnvs()
  })
})
