import { sentry } from 'lib'

const reported = new Set<string>()

export function reportRetiredJob(component: string, name: string) {
  console.warn('🚨', `unknown ${component} job`, name)
  const key = `${component}:${name}`
  if (reported.has(key)) return
  reported.add(key)
  sentry.captureMessage(`unknown ${component} job ${name}`, { level: 'warning', tags: { component } })
}
