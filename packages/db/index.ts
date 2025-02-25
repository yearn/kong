// @ts-expect-error db-migrate is not typed
import DBMigrate from 'db-migrate'
import path from 'path'

const currentDir = path.resolve(__dirname)

export function migrate({ host, port, user, password, database }: { host: string, port: number, user: string, password: string, database: string }) {
  const instance = DBMigrate.getInstance(true, {
    cwd: currentDir,
    config: {
      dev: {
        host,
        port,
        user,
        password,
        database
      }
    }
  })
  return instance.up().then(() => {
    console.log('migration complete')
  })
}
