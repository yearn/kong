import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getJobById, queueNames } from '../../../lib'
import styles from '../../../mq.module.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ queue: string; jobId: string }>

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '-'
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
}

function formatDuration(start: number | undefined, end: number | undefined): string {
  if (!start || !end) return '-'
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

export default async function JobDetail({ params }: { params: Params }) {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/')
  }

  const { queue, jobId } = await params
  const queueName = decodeURIComponent(queue)

  if (!queueNames.includes(queueName)) {
    notFound()
  }

  const job = await getJobById(queueName, jobId)

  if (!job) {
    notFound()
  }

  const waitTime = formatDuration(job.timestamp, job.processedOn)
  const runTime = formatDuration(job.processedOn, job.finishedOn)

  return (
    <div className={styles.container}>
      <p className={styles.backLink}>
        <Link href={`/mq/${encodeURIComponent(queueName)}`}>&larr; Back to {queueName}</Link>
      </p>
      <h1>Job {job.id}</h1>

      <div className={styles.jobDetail}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Queue</span>
          <span>{queueName}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Name</span>
          <span>{job.name}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>Attempts</span>
          <span>{job.attemptsMade}</span>
        </div>
      </div>

      <h2>Timeline</h2>
      <div className={styles.timeline}>
        <div className={styles.timelineItem}>
          <span className={styles.timelineDot}></span>
          <span className={styles.timelineLabel}>Created</span>
          <span className={styles.timelineValue}>{formatTimestamp(job.timestamp)}</span>
        </div>
        <div className={styles.timelineItem}>
          <span className={styles.timelineDot}></span>
          <span className={styles.timelineLabel}>Processed</span>
          <span className={styles.timelineValue}>
            {formatTimestamp(job.processedOn)}
            {job.processedOn && <span className={styles.timelineDuration}>(waited {waitTime})</span>}
          </span>
        </div>
        <div className={styles.timelineItem}>
          <span className={styles.timelineDot}></span>
          <span className={styles.timelineLabel}>Finished</span>
          <span className={styles.timelineValue}>
            {formatTimestamp(job.finishedOn)}
            {job.finishedOn && <span className={styles.timelineDuration}>(ran {runTime})</span>}
          </span>
        </div>
      </div>

      <h2>Data</h2>
      <pre className={styles.fullData}>{JSON.stringify(job.data, null, 2)}</pre>

      {job.returnvalue !== undefined && job.returnvalue !== null && (
        <>
          <h2>Return Value</h2>
          <pre className={styles.fullData}>{JSON.stringify(job.returnvalue, null, 2)}</pre>
        </>
      )}

      {job.failedReason && (
        <>
          <h2>Error</h2>
          <p className={styles.errorMessage}>{job.failedReason}</p>
        </>
      )}

      {job.stacktrace && job.stacktrace.length > 0 && (
        <>
          <h2>Stack Trace</h2>
          <pre className={styles.stacktrace}>{job.stacktrace.join('\n')}</pre>
        </>
      )}
    </div>
  )
}
