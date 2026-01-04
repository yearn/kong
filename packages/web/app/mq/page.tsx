import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getAllQueueStats, QueueStats } from './lib'
import styles from './mq.module.css'

export const dynamic = 'force-dynamic'

export default async function MQDashboard() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/')
  }

  const stats = await getAllQueueStats()

  return (
    <div className={styles.container}>
      <h1>MQ Dashboard</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Queue</th>
            <th>Waiting</th>
            <th>Active</th>
            <th>Completed</th>
            <th>Failed</th>
            <th>Delayed</th>
            <th>Paused</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(q => (
            <QueueRow key={q.name} queue={q} />
          ))}
        </tbody>
      </table>
      <p className={styles.note}>
        <a href="/mq">Refresh</a> | <a href="/api/mq">JSON API</a>
      </p>
    </div>
  )
}

function QueueRow({ queue: q }: { queue: QueueStats }) {
  const waiting = q.waiting + q.prioritized
  return (
    <tr>
      <td>
        <Link href={`/mq/${encodeURIComponent(q.name)}`}>{q.name}</Link>
      </td>
      <td className={waiting > 0 ? styles.warning : ''}>{waiting}</td>
      <td className={q.active > 0 ? styles.info : ''}>{q.active}</td>
      <td>{q.completed}</td>
      <td className={q.failed > 0 ? styles.danger : ''}>{q.failed}</td>
      <td>{q.delayed}</td>
      <td>{q.isPaused ? 'Yes' : 'No'}</td>
    </tr>
  )
}
