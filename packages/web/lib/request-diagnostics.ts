// Symbol.for survives separate Next.js route/instrumentation bundles. Never store
// the Request, its headers, body, URL or GraphQL variables on the exception.
const diagnosticsKey = Symbol.for('kong.request-diagnostics')
type Diagnostics = {
  operation: 'graphql.request'
  stage: 'request.json' | 'graphql.handle'
  requestId: string
  providerRequestId?: string
  contentType?: string
  contentLength?: number
  elapsedMs: number
  errorClass: string
}

function safeErrorClass(error: unknown): string {
  if (error instanceof SyntaxError) return 'SyntaxError'
  if (error instanceof TypeError) return 'TypeError'
  if (error instanceof Error) return 'Error'
  return 'NonError'
}

export function getRequestDiagnostics(error: unknown): Diagnostics | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  return (error as { [diagnosticsKey]?: Diagnostics })[diagnosticsKey]
}

// JSON parser messages can quote body fragments. Preserve the useful stack
// frames but never send the parser's message (or cause) to Bugsink.
export function safeRequestException(error: unknown, diagnostics?: Diagnostics): unknown {
  if (diagnostics?.stage !== 'request.json') return error
  const safe = new Error('Failed to read incoming GraphQL JSON body')
  safe.name = diagnostics.errorClass
  if (error instanceof Error && error.stack) {
    const frames = error.stack.split('\n').filter(line => /^\s+at /.test(line))
    safe.stack = `${safe.name}: ${safe.message}\n${frames.join('\n')}`
  }
  return safe
}

export async function withRequestDiagnostics<T>(request: Request, handle: (request: Request) => Promise<T>): Promise<T> {
  const started = performance.now()
  const requestId = crypto.randomUUID()
  // Retain only a recognized media type, never arbitrary header text/parameters.
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const contentType = mediaType && /^(application\/(json|graphql)|text\/plain)$/.test(mediaType) ? mediaType : undefined
  const length = request.headers.get('content-length')
  const contentLength = length && /^\d{1,12}$/.test(length) ? Number(length) : undefined
  // Vercel's infrastructure ID is useful for correlating provider logs. Ignore
  // arbitrary correlation headers; they can contain private client data.
  const providerId = request.headers.get('x-vercel-id')
  const providerRequestId = providerId && /^[a-z]{3}\d::[a-z]{3}\d::[a-zA-Z0-9-]{1,100}$/.test(providerId) ? providerId : undefined
  let stage: Diagnostics['stage'] = 'graphql.handle'
  const originalJson = request.json
  request.json = async () => {
    stage = 'request.json'
    const body = await originalJson.call(request)
    stage = 'graphql.handle'
    return body
  }
  try {
    return await handle(request)
  } catch (error) {
    if (typeof error === 'object' && error !== null) {
      const diagnostics: Diagnostics = {
        operation: 'graphql.request', stage, requestId, providerRequestId,
        contentType, contentLength, elapsedMs: Math.round(performance.now() - started),
        errorClass: safeErrorClass(error)
      }
      try { Object.defineProperty(error, diagnosticsKey, { value: diagnostics, configurable: true }) } catch { /* Frozen errors must still propagate unchanged. */ }
    }
    throw error
  } finally {
    request.json = originalJson
  }
}
