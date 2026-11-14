import { describe, it, expect, vi } from 'vitest'
import { getRequestDiagnostics, safeRequestException, withRequestDiagnostics } from './request-diagnostics'

describe('GraphQL request diagnostics', () => {
  it('identifies malformed incoming JSON without retaining private body/header/query data', async () => {
    const secret = 'do-not-log-this'
    const request = new Request(`https://example.com/api/gql?token=${secret}`, {
      method: 'POST', body: `{"secret":"${secret}\u0001"}`,
      headers: { 'content-type': 'application/json', 'content-length': '42', authorization: `Bearer ${secret}`, cookie: secret, 'x-request-id': secret }
    })
    const originalJson = request.json
    let caught: unknown
    try { await withRequestDiagnostics(request, r => r.json()) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(SyntaxError)
    expect(request.json).toBe(originalJson)
    const diagnostics = getRequestDiagnostics(caught)
    expect(diagnostics).toMatchObject({ operation: 'graphql.request', stage: 'request.json', errorClass: 'SyntaxError', contentType: 'application/json', contentLength: 42 })
    expect(diagnostics?.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(diagnostics?.requestId).toMatch(/^[a-f0-9-]{36}$/)
    const safe = safeRequestException(caught, diagnostics) as Error
    expect(safe.message).toBe('Failed to read incoming GraphQL JSON body')
    expect(JSON.stringify(diagnostics) + safe.message + safe.stack).not.toContain(secret)
    expect(safe).not.toHaveProperty('cause')
  })

  it('reads the body once and distinguishes later handler failures', async () => {
    const request = new Request('https://example.com/api/gql', { method: 'POST', body: '{"query":"x"}', headers: { 'content-type': 'application/json; charset=utf-8' } })
    const read = vi.spyOn(request, 'json')
    const failure = new Error('handler failed')
    await expect(withRequestDiagnostics(request, async r => { expect(await r.json()).toEqual({ query: 'x' }); throw failure })).rejects.toBe(failure)
    expect(read).toHaveBeenCalledOnce()
    expect(getRequestDiagnostics(failure)).toMatchObject({ stage: 'graphql.handle', contentType: 'application/json' })
    expect(safeRequestException(failure, getRequestDiagnostics(failure))).toBe(failure)
  })

  it('returns the original response and restores body parsing after success', async () => {
    const request = new Request('https://example.com/api/gql')
    const json = request.json
    const response = new Response('ok')
    expect(await withRequestDiagnostics(request, async () => response)).toBe(response)
    expect(request.json).toBe(json)
  })

  it('bounds header metadata and retains only provider-shaped request IDs', async () => {
    const request = new Request('https://example.com/api/gql', { headers: { 'content-type': 'private-header', 'content-length': '-1', 'x-vercel-id': 'iad1::iad1::abc-123' } })
    const failure = new TypeError('failure')
    await expect(withRequestDiagnostics(request, async () => { throw failure })).rejects.toBe(failure)
    expect(getRequestDiagnostics(failure)).toMatchObject({ providerRequestId: 'iad1::iad1::abc-123', errorClass: 'TypeError', contentType: undefined, contentLength: undefined })
  })

  it('does not break propagation for frozen errors or non-error throws', async () => {
    for (const failure of [Object.freeze(new Error('frozen')), 'failure']) {
      await expect(withRequestDiagnostics(new Request('https://example.com'), async () => { throw failure })).rejects.toBe(failure)
    }
  })

  it('does not leak a quoted JSON fragment from engine-specific parser errors', () => {
    const failure = new SyntaxError('"private-body" is not valid JSON')
    const safe = safeRequestException(failure, { operation: 'graphql.request', stage: 'request.json', errorClass: 'SyntaxError', elapsedMs: 1, requestId: 'test' }) as Error
    expect(safe.stack).not.toContain('private-body')
  })
})
