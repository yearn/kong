import { mq, sentry } from 'lib'

const reported = new Set<string>()

export function reportRetiredJob(component: string, name: string) {
  console.warn('🚨', `unknown ${component} job`, name)
  const key = `${component}:${name}`
  if (reported.has(key)) return
  reported.add(key)
  sentry.captureMessage(`unknown ${component} job ${name}`, { level: 'warning', tags: { component } })
}

export async function quarantineUnknownJob(component: string, job: { queueName: string, id?: string, name: string, data: unknown }) {
  const unknown = new Error(`unknown ${component} job ${job.name}`)
  try {
    await mq.quarantine(job)
  } catch (error) {
    // A later failure can trim the shared failed set regardless of this job's policy.
    // Report copy failure explicitly; recovery is limited to the normal failed-set window.
    sentry.captureException(error, { tags: { component, phase: 'quarantine_write', queue: job.queueName }, extra: { jobId: job.id, jobName: job.name } })
  }
  throw unknown
}

let lastQuarantineAlert = 0
export function reportQuarantineDepth(depth: number) {
  if (!depth) { lastQuarantineAlert = 0; return }
  if (lastQuarantineAlert && Date.now() - lastQuarantineAlert < 60_000) return
  lastQuarantineAlert = Date.now()
  console.error('QUARANTINE_BACKLOG', { depth })
  sentry.captureMessage('QUARANTINE_BACKLOG', { level: 'error', tags: { component: 'ingest', queue: 'quarantine' }, extra: { depth } })
}
