import { Redis, Postgres, dbMigrate, setTestcontainersEnv } from 'lib/helpers/tests'
import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import { AbstractStartedContainer } from 'testcontainers'

const containers: AbstractStartedContainer[] = []

async function spawnTestContainersAndRun() {
  const postgres = await Postgres.start()
  const redis = await Redis.start()
  containers.push(postgres, redis)

  await dbMigrate({ postgres })
  return setTestcontainersEnv({ postgres, redis })
}

function shutdownTestcontainers() {
  containers.forEach(container => container.stop())
}

let mochaProcess: ChildProcess


spawnTestContainersAndRun().then((env) => {
  const customEnv = {
    POSTGRES_HOST: env.host,
    POSTGRES_PORT: env.port,
    POSTGRES_USER: env.user,
    POSTGRES_PASSWORD: env.password,
    POSTGRES_DB: env.database,
    REDIS_HOST: env.redisHost,
    REDIS_PORT: env.redisPort,
  }

  const mochaBin = path.resolve(__dirname, '../../node_modules/.bin/mocha')

  mochaProcess = spawn(mochaBin, ['--timeout 5000'], {
    // @ts-expect-error env is not typed
    env: {
      ...customEnv,
      ...process.env
    },
    stdio: 'inherit', // Pipe stdio to parent process
    shell: true
  })

  // Handle process events
  mochaProcess.on('close', (code: number) => {
    shutdownTestcontainers()
    process.exit(code)
  })

  mochaProcess.on('error', (err) => {
    shutdownTestcontainers()
    process.exit(1)
  })


  process.on('SIGINT', () => {
    shutdownTestcontainers()
    mochaProcess.kill()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    shutdownTestcontainers()
    mochaProcess.kill()
    process.exit(0)
  })
})

