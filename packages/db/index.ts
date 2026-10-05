// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import DBMigrate from 'db-migrate'
import path from 'path'

const currentDir = path.resolve(__dirname)

export function migrate({ host, port, user, password, database, workersStopped = false }: { workersStopped?: boolean, host: string, port: number, user: string, password: string, database: string }) {
  const instance = DBMigrate.getInstance(true, {
    cwd: currentDir,
    config: {
      dev: {
        driver: 'postgresql',
        host,
        port,
        user,
        password,
        database,
        ...(workersStopped ? { options: '-c kong.signature_migration_workers_stopped=on' } : {})
      }
    }
  })
  return instance.up().then(() => {
    console.log('migration complete')
  })
}
