import { expect } from 'chai'
import { vi } from 'vitest'

const captured: unknown[] = []
vi.mock('@sentry/node', () => ({
  init: vi.fn(), flush: vi.fn(async () => true),
  captureException: (e: unknown) => captured.push(e)
}))

describe('sentry', function() {
  it('samples InvalidParamsRpcError and keeps other errors', async function() {
    process.env.SENTRY_DSN = 'https://k@example.com/1'
    vi.resetModules()
    const { captureException, flush } = await import('./sentry')
    const noisy = Object.assign(new Error('x'), { name: 'InvalidParamsRpcError' })
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.5)
    captureException(noisy)
    captureException(new Error('kept'))
    random.mockReturnValue(0.001)
    captureException(noisy)
    await flush()
    await new Promise(r => setTimeout(r, 0))
    expect(captured.map(e => (e as Error).message)).to.deep.equal(['kept', 'x'])
    random.mockRestore()
    delete process.env.SENTRY_DSN
  })
})
