import * as Sentry from '@sentry/node'

const SENTRY_DSN = process.env.SENTRY_DSN

if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN })
}

export function captureMessage(
  message: string,
  options?: Parameters<typeof Sentry.captureMessage>[1]
) {
  if (!SENTRY_DSN) return
  Sentry.captureMessage(message, options)
}
