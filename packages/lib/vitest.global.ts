import { Postgres, Redis, dbMigrate, setTestcontainersEnv } from './helpers/tests'

// Runs once in the main vitest process, before any worker is forked: starts the
// shared postgres + redis containers, migrates the schema and publishes the
// connection env.
export default async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const postgres = await Postgres.start()
  const redis = await Redis.start()
  await dbMigrate({ postgres })
  const env = setTestcontainersEnv({ postgres, redis })
  provide('testcontainers', env)
  return async () => {
    await Promise.all([postgres.stop(), redis.stop()])
  }
}
