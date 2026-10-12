import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import path from 'path'
import { Pool } from 'pg'

export function migrate({ host, port, user, password, database }: { host: string, port: number, user: string, password: string, database: string }) {
  const pool = new Pool({ host, port, user, password, database })
  return drizzleMigrate(drizzle(pool), { migrationsFolder: path.join(__dirname, 'drizzle') })
    .then(() => console.log('migration complete'))
    .finally(() => pool.end())
}
