import { Postgres, Redis, dbMigrate, setTestcontainersEnv } from 'lib/helpers/tests'

// Runs once in the main vitest process, before any test worker is forked.
// Starts the shared postgres + redis containers, migrates the schema and
// publishes the connection env (inherited by the forked worker + provided for
// the setup file).
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
