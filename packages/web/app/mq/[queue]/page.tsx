import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getQueueStats, queueNames, QueueStats } from '../lib'
import styles from '../mq.module.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ queue: string }>

export default async function QueueDetail({ params }: { params: Params }) {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/')
  }

  const { queue } = await params
  const queueName = decodeURIComponent(queue)

  if (!queueNames.includes(queueName)) {
    notFound()
  }

  const stats = await getQueueStats(queueName)
  const statuses: (keyof QueueStats)[] = ['prioritized', 'waiting', 'active', 'failed', 'delayed', 'completed']

  return (
    <div className={styles.container}>
      <p className={styles.backLink}>
        <Link href="/mq">&larr; Back to all queues</Link>
      </p>
      <h1>{queueName}</h1>
      <div className={styles.stats}>
        <span className={styles.stat}>
          Prioritized: <strong className={stats.prioritized > 0 ? styles.statWarning : ''}>{stats.prioritized}</strong>
        </span>
        <span className={styles.stat}>
          Waiting: <strong className={stats.waiting > 0 ? styles.statWarning : ''}>{stats.waiting}</strong>
        </span>
        <span className={styles.stat}>
          Active: <strong>{stats.active}</strong>
        </span>
        <span className={styles.stat}>
          Failed: <strong className={stats.failed > 0 ? styles.statDanger : ''}>{stats.failed}</strong>
        </span>
        <span className={styles.stat}>
          Delayed: <strong>{stats.delayed}</strong>
        </span>
        <span className={styles.stat}>
          Completed: <strong>{stats.completed}</strong>
        </span>
      </div>
      <h2>View Jobs</h2>
      <p className={styles.links}>
        {statuses.map(s => (
          <Link key={s} href={`/mq/${encodeURIComponent(queueName)}/${s}`}>
            {s} ({stats[s]})
          </Link>
        ))}
      </p>
      <p className={styles.note}>
        <a href={`/mq/${encodeURIComponent(queueName)}`}>Refresh</a>
      </p>
    </div>
  )
}
