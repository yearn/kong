import { createHash } from 'node:crypto'
import diagnosticsChannel from 'node:diagnostics_channel'
import { countMetric } from './metrics'

export type OutboundDestination = 'rpc' | 'database'

const MAX_RPC_ENDPOINTS = 64
const rpcEndpointFingerprints = new Set<string>()
let undiciSubscribed = false

function enabled() {
  return process.env.OUTBOUND_BYTES_METRICS === 'true'
}

function fingerprint(origin: string, path: string) {
  return createHash('sha256').update(`${origin}${path}`).digest('hex')
}

export function recordOutboundBytes(destination: OutboundDestination, bytes: number) {
  if (!enabled() || !Number.isSafeInteger(bytes) || bytes <= 0) return
  try {
    countMetric('outbound.payload_bytes', bytes, { destination })
  } catch {
    // Accounting must not change RPC or database behavior.
  }
}

function recordOutboundEnvelope(destination: OutboundDestination) {
  if (!enabled()) return
  try {
    countMetric('outbound.http_envelopes', 1, { destination })
  } catch {
    // Accounting must not change RPC or database behavior.
  }
}

function onUndiciBodySent(message: unknown) {
  if (!enabled() || typeof message !== 'object' || message === null) return
  const request = (message as { request?: unknown }).request
  if (typeof request !== 'object' || request === null) return

  const { origin, path, contentLength } = request as {
    origin?: unknown
    path?: unknown
    contentLength?: unknown
  }
  if (typeof origin !== 'string' || typeof path !== 'string') return
  const bytes = typeof contentLength === 'number' ? contentLength : Number(contentLength)
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return

  try {
    if (rpcEndpointFingerprints.has(fingerprint(origin, path))) {
      recordOutboundEnvelope('rpc')
      recordOutboundBytes('rpc', bytes)
    }
  } catch {
    // Ignore malformed diagnostic events and hashing failures.
  }
}

/** Register the exact resolved RPC endpoint without retaining or exporting its URL or credentials. */
export function observeRpcEndpoint(endpoint: string | undefined) {
  if (!enabled() || !endpoint) return

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (rpcEndpointFingerprints.size < MAX_RPC_ENDPOINTS) {
      rpcEndpointFingerprints.add(fingerprint(url.origin, `${url.pathname}${url.search}`))
    }

    if (!undiciSubscribed) {
      diagnosticsChannel.channel('undici:request:bodySent').subscribe(onUndiciBodySent)
      undiciSubscribed = true
    }
  } catch {
    // Invalid endpoints are handled by viem; attribution can safely omit them.
  }
}
