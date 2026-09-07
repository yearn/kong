import { strict as assert } from 'node:assert'

const { disconnect } = vi.hoisted(() => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./cache', () => ({ disconnect }))

import { runCli } from './run-cli'

describe('runCli', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    disconnect.mockClear()
  })

  it('disconnects and exits 0 when the job resolves', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    runCli(async () => {})
    await vi.waitFor(() => assert.equal(exit.mock.calls[0]?.[0], 0))
    assert.equal(disconnect.mock.calls.length, 1)
  })

  it('disconnects and exits 1 when the job rejects', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    runCli(async () => {
      throw new Error('boom')
    })
    await vi.waitFor(() => assert.equal(exit.mock.calls[0]?.[0], 1))
    assert.equal(disconnect.mock.calls.length, 1)
  })
})
