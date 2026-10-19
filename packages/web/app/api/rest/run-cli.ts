import { disconnect } from './cache'

export function runCli(job: () => Promise<void>): void {
  console.info('rest refresh CLI', { job: job.name, source: 'local', startedAt: new Date().toISOString() })
  job()
    .then(async () => {
      await disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await disconnect()
      process.exit(1)
    })
}
