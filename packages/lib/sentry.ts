const SENTRY_DSN = process.env.SENTRY_DSN

let sentryPromise: Promise<typeof import('@sentry/node') | null> | undefined

async function getSentry() {
  if (!SENTRY_DSN) return null

  if (!sentryPromise) {
    sentryPromise = import('@sentry/node')
      .then(Sentry => {
        Sentry.init({ dsn: SENTRY_DSN, sampleRate: Number(process.env.SENTRY_SAMPLE_RATE || 1) })
        return Sentry
      })
      .catch(() => null)
  }

  return sentryPromise
}

export function captureMessage(
  message: string,
  options?: Parameters<(typeof import('@sentry/node'))['captureMessage']>[1]
) {
  void getSentry().then(Sentry => {
    if (!Sentry) return
    Sentry.captureMessage(message, options)
  })
}

// Errors we never report: expected, high-volume blockchain read failures.
// Matched by name since viem does not export PositionOutOfBoundsError from
// its package root.
const IGNORED_ERROR_NAMES = new Set([
  'PositionOutOfBoundsError',
  'ContractFunctionExecutionError'
])

const SAMPLED_ERROR_RATES: Record<string, number> = {
  InvalidParamsRpcError: 0.01
}

export function captureException(
  exception: unknown,
  options?: Parameters<(typeof import('@sentry/node'))['captureException']>[1]
) {
  if (exception instanceof Error && IGNORED_ERROR_NAMES.has(exception.name)) return
  if (exception instanceof Error && Math.random() >= (SAMPLED_ERROR_RATES[exception.name] ?? 1)) return
  void getSentry().then(Sentry => {
    if (!Sentry) return
    Sentry.captureException(exception, options)
  })
}

export async function flush(timeout?: number) {
  if (!sentryPromise) return

  const Sentry = await sentryPromise
  if (!Sentry) return
  await Sentry.flush(timeout)
}
