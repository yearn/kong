import type { Pool, PoolClient } from 'pg'
import { outboundBytesEnabled, recordOutboundBytes } from 'lib/outbound-bytes'

type Writable = { write: (chunk: unknown, ...args: unknown[]) => unknown }
type ClientWithStream = PoolClient & { connection?: { stream?: Writable } }

const instrumentedStreams = new WeakSet<object>()

/** Subscribe to pool connection events only when byte accounting is enabled. */
export function instrumentPostgresPool(pool: Pool) {
  if (!outboundBytesEnabled()) return
  try {
    pool.on('connect', instrumentPostgresClient)
  } catch {
    // Missing event support should not prevent the pool from being used.
  }
}

function byteLength(chunk: unknown, encoding: unknown): number | undefined {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : 'utf8')
  }
  if (chunk instanceof Uint8Array) return chunk.byteLength
  return undefined
}

/** Count PostgreSQL protocol bytes written by one established pool connection. */
export function instrumentPostgresClient(client: PoolClient) {
  if (!outboundBytesEnabled()) return

  try {
    const stream = (client as ClientWithStream).connection?.stream
    if (!stream || typeof stream.write !== 'function' || instrumentedStreams.has(stream)) return

    const originalWrite = stream.write
    stream.write = function(this: unknown, chunk: unknown, ...args: unknown[]) {
      const result = originalWrite.call(this, chunk, ...args)
      try {
        const size = byteLength(chunk, args[0])
        if (size !== undefined) recordOutboundBytes('database', size)
      } catch {
        // A telemetry issue must not change a successful database write.
      }
      return result
    }
    instrumentedStreams.add(stream)
  } catch {
    // A stream we cannot instrument should continue to work normally.
  }
}
