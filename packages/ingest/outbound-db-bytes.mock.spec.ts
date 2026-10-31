import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'

const { recordOutboundBytes } = vi.hoisted(() => ({ recordOutboundBytes: vi.fn() }))
vi.mock('lib/outbound-bytes', () => ({ recordOutboundBytes }))

import { instrumentPostgresClient } from './outbound-db-bytes'

afterEach(() => {
  vi.unstubAllEnvs()
  recordOutboundBytes.mockReset()
})

type StreamWrite = (this: unknown, chunk: unknown, ...args: unknown[]) => unknown

function fakeClient(write: StreamWrite) {
  const stream = { write }
  const client = { connection: { stream } }
  return { stream, client: client as unknown as PoolClient }
}

describe('PostgreSQL outbound byte instrumentation', function() {
  it('counts bytes after a successful write and preserves receiver, arguments, and return value', function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    const result = { writable: true }
    const callback = vi.fn()
    const write = vi.fn(function(this: unknown) {
      return result
    })
    const { client, stream } = fakeClient(write)

    instrumentPostgresClient(client)
    expect(stream.write(Buffer.from([1, 2, 3]), callback)).to.equal(result)

    expect(write.mock.contexts[0]).to.equal(stream)
    expect(write.mock.calls[0] as unknown[]).to.deep.equal([Buffer.from([1, 2, 3]), callback])
    expect(recordOutboundBytes).toHaveBeenCalledWith('database', 3)
  })

  it('counts strings using their requested encoding and isolates a failing observer', function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    recordOutboundBytes.mockImplementation(() => { throw new Error('metrics unavailable') })
    const { client, stream } = fakeClient(() => true)

    instrumentPostgresClient(client)
    expect(stream.write('abc', 'utf16le')).to.equal(true)
    expect(recordOutboundBytes).toHaveBeenCalledWith('database', 6)
  })

  it('preserves write errors and does not count rejected chunks', function() {
    vi.stubEnv('OUTBOUND_BYTES_METRICS', 'true')
    const error = new Error('stream failed')
    const { client, stream } = fakeClient(() => { throw error })

    instrumentPostgresClient(client)
    expect(() => stream.write(Buffer.from([1]))).to.throw(error)
    expect(recordOutboundBytes).not.toHaveBeenCalled()
  })
})
