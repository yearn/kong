import { mq, sentry } from 'lib'

const reported = new Set<string>()

export function reportRetiredJob(component: string, name: string) {
  console.warn('🚨', `unknown ${component} job`, name)
  const key = `${component}:${name}`
  if (reported.has(key)) return
  reported.add(key)
  sentry.captureMessage(`unknown ${component} job ${name}`, { level: 'warning', tags: { component } })
}

export async function quarantineUnknownJob(component: string, job: { queueName: string, id?: string, name: string, data: unknown, opts: { removeOnFail?: boolean | number | { age?: number, count?: number } } }) {
  const unknown = new Error(`unknown ${component} job ${job.name}`)
  try {
    await mq.quarantine(job)
  } catch (error) {
    // BullMQ reads this option when it moves the active job to the failed set.
    // Keep the original payload for manual recovery if its durable copy failed.
    job.opts.removeOnFail = false
    sentry.captureException(error, { tags: { component, phase: 'quarantine_write', queue: job.queueName }, extra: { jobId: job.id, jobName: job.name } })
  }
  throw unknown
}
