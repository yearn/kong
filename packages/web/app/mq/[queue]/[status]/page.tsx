import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getQueueStats, getQueueJobs, queueNames, validStatuses, JobStatus, QueueStats } from '../../lib'
import styles from '../../mq.module.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ queue: string; status: string }>
type SearchParams = Promise<{ start?: string; end?: string; last?: string }>

const PAGE_SIZE = 50

export default async function JobsList({
  params,
  searchParams
}: {
  params: Params
  searchParams: SearchParams
}) {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/')
  }

  const { queue, status } = await params
  const queueName = decodeURIComponent(queue)

  if (!queueNames.includes(queueName)) {
    notFound()
  }

  if (!validStatuses.includes(status as JobStatus)) {
    notFound()
  }

  const sp = await searchParams
  const stats = await getQueueStats(queueName)
  const total = stats[status as keyof QueueStats] as number || 0

  let start = parseInt(sp.start || '0')
  let end = parseInt(sp.end || String(PAGE_SIZE))

  if (sp.last === 'true') {
    start = Math.max(0, total - PAGE_SIZE)
    end = total
  }

  const jobs = await getQueueJobs(queueName, status as JobStatus, start, end)

  const prevStart = Math.max(0, start - PAGE_SIZE)
  const prevEnd = start
  const nextStart = end
  const nextEnd = end + PAGE_SIZE
  const hasMore = start + jobs.length < total

  return (
    <div className={styles.container}>
      <p className={styles.backLink}>
        <Link href={`/mq/${encodeURIComponent(queueName)}`}>&larr; Back to {queueName}</Link>
      </p>
      <h1>
        {queueName} / {status}
        <span className={styles.count}>({start + 1}-{start + jobs.length} of {total})</span>
      </h1>
      <div className={styles.pagination}>
        <Link href={`?start=0&end=${PAGE_SIZE}`} className={start === 0 ? styles.disabled : ''}>
          &laquo; First
        </Link>
        <Link href={`?start=${prevStart}&end=${prevEnd}`} className={start === 0 ? styles.disabled : ''}>
          &larr; Prev
        </Link>
        <Link href={`?start=${nextStart}&end=${nextEnd}`} className={!hasMore ? styles.disabled : ''}>
          Next &rarr;
        </Link>
        <Link href="?last=true" className={!hasMore ? styles.disabled : ''}>
          Last &raquo;
        </Link>
        <a href={`/api/mq?queue=${encodeURIComponent(queueName)}&status=${status}&start=${start}&end=${end}`}>
          JSON
        </a>
      </div>
      <table className={styles.jobsTable}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Age</th>
            <th>Attempts</th>
            <th>Data</th>
            {status === 'failed' && <th>Error</th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => {
            const age = job.timestamp ? Math.floor((Date.now() - job.timestamp) / 1000) : 0
            const ageStr = age > 3600
              ? `${Math.floor(age / 3600)}h`
              : age > 60
                ? `${Math.floor(age / 60)}m`
                : `${age}s`
            const dataJson = JSON.stringify(job.data)
            const dataPreview = dataJson.slice(0, 200)

            return (
              <tr key={job.id}>
                <td>
                  <Link href={`/mq/${encodeURIComponent(queueName)}/job/${job.id}`} className={styles.jobIdLink}>
                    {job.id}
                  </Link>
                </td>
                <td>{job.name}</td>
                <td title={new Date(job.timestamp || 0).toISOString()}>{ageStr} ago</td>
                <td>{job.attemptsMade}</td>
                <td className={styles.dataCell} title={JSON.stringify(job.data, null, 2)}>
                  {dataPreview}{dataJson.length > 200 ? '...' : ''}
                </td>
                {status === 'failed' && (
                  <td className={styles.errorCell}>{job.failedReason || ''}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.note}>Hover over data cell to see full JSON</p>
    </div>
  )
}
