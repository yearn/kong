const SENTRY_DSN = process.env.SENTRY_DSN

let sentryPromise: Promise<typeof import('@sentry/node') | null> | undefined

async function getSentry() {
  if (!SENTRY_DSN) return null

  if (!sentryPromise) {
    sentryPromise = import('@sentry/node')
      .then(Sentry => {
        Sentry.init({ dsn: SENTRY_DSN })
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

export function countMetric(
  name: string,
  value: number,
  attributes: Record<string, string>
) {
  void getSentry().then(Sentry => {
    if (!Sentry) return
    Sentry.metrics.count(name, value, { attributes })
  })
}

export async function flush(timeout?: number) {
  if (!sentryPromise) return

  const Sentry = await sentryPromise
  if (!Sentry) return
  await Sentry.flush(timeout)
}
