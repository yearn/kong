import { Redis, setTestcontainersEnv } from 'lib/helpers/tests'
import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import { AbstractStartedContainer } from 'testcontainers'
import dotenv from 'dotenv'

const containers: AbstractStartedContainer[] = []

async function spawnTestContainersAndRun() {
  const redis = await Redis.start()
  containers.push(redis)
  return { redis, env: setTestcontainersEnv({ redis }) }
}

async function shutdownTestcontainers() {
  console.log('Shutting down containers...')
  try {
    // Add timeout to prevent hanging
    await Promise.race([
      Promise.all(containers.map(container => container.stop())),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Container shutdown timeout')), 10000)
      )
    ])
    console.log('Containers shut down')
  } catch (error) {
    console.error('Error shutting down containers:', error)
    console.log('Forcing exit due to container shutdown issues')
  }
}

let mochaProcess: ChildProcess
const envPath = path.join(__dirname, '../../..', '.env')
dotenv.config({ path: envPath })

spawnTestContainersAndRun().then(({ env }) => {
  const customEnv = {
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_PORT: process.env.POSTGRES_PORT,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    POSTGRES_DB: process.env.POSTGRES_DB,
    REDIS_HOST: env.redisHost,
    REDIS_PORT: env.redisPort,
  }

  const mochaBin = path.resolve(__dirname, '../../../node_modules/.bin/mocha')
  const configFile = path.resolve(__dirname, '.mocharc.json')
  const testsDir = __dirname

  mochaProcess = spawn(mochaBin, ['--config', configFile, '--timeout', '50000'], {
    env: {
      ...customEnv,
      ...process.env
    },
    cwd: testsDir,
    stdio: 'inherit', // Pipe stdio to parent process
    shell: true
  })

  let isShuttingDown = false

  async function cleanup(code: number = 0) {
    if (isShuttingDown) return
    isShuttingDown = true

    const forceExitTimer = setTimeout(() => {
      process.exit(code || 1)
    }, 15000)

    try {
      await shutdownTestcontainers()
      clearTimeout(forceExitTimer)
      process.exit(code)
    } catch (error) {
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
  }

  // Handle process events
  mochaProcess.on('close', (code: number) => {
    cleanup(code || 0)
  })

  mochaProcess.on('exit', (code: number) => {
    cleanup(code || 0)
  })

  mochaProcess.on('error', (err) => {
    cleanup(1)
  })


  process.on('SIGINT', () => {
    mochaProcess.kill('SIGINT')
  })

  process.on('SIGTERM', () => {
    mochaProcess.kill('SIGTERM')
  })
})

