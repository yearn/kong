import { sentry } from 'lib'

const reported = new Set<string>()

export function reportRetiredJob(component: string, name: string) {
  console.warn('🚨', `retired ${component} job`, name)
  const key = `${component}:${name}`
  if (reported.has(key)) return
  reported.add(key)
  sentry.captureMessage(`retired ${component} job ${name}`, { level: 'warning', tags: { component } })
}
