import type { Instrumentation } from 'next'
import { getRequestDiagnostics, safeRequestException } from './lib/request-diagnostics'

// Sentry/Bugsink for the Next.js app. lib/sentry initializes lazily from SENTRY_DSN
// (same as ingest) and is a no-op when the DSN is unset.
export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const sentry = await import('lib/sentry')
  const diagnostics = getRequestDiagnostics(error)
  sentry.captureException(safeRequestException(error, diagnostics), {
    tags: { component: 'web', route: context.routePath, routeType: context.routeType, ...(diagnostics ? { operation: diagnostics.operation, stage: diagnostics.stage, errorClass: diagnostics.errorClass } : {}) },
    extra: { method: request.method, path: request.path.split('?')[0], ...(diagnostics ? { diagnostics } : {}) }
  })
  await sentry.flush(2000)
}
