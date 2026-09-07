import { disconnect } from './cache'

export function runCli(job: () => Promise<void>): void {
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
