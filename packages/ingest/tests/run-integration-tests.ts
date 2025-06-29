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

  mochaProcess = spawn(mochaBin, ['--config', configFile, '--timeout', '30000'], {
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

    console.log('Cleaning up and shutting down...')

    // Force exit after 15 seconds if cleanup hangs
    const forceExitTimer = setTimeout(() => {
      console.log('Force exiting due to cleanup timeout')
      process.exit(code || 1)
    }, 15000)

    try {
      await shutdownTestcontainers()
      clearTimeout(forceExitTimer)
      console.log('Cleanup complete, exiting with code:', code)
      process.exit(code)
    } catch (error) {
      clearTimeout(forceExitTimer)
      console.error('Error during cleanup:', error)
      process.exit(1)
    }
  }

  // Handle process events
  mochaProcess.on('close', (code: number) => {
    console.log('Mocha process closed with code:', code)
    cleanup(code || 0)
  })

  mochaProcess.on('exit', (code: number) => {
    console.log('Mocha process exited with code:', code)
    cleanup(code || 0)
  })

  mochaProcess.on('error', (err) => {
    console.error('Mocha process error:', err)
    cleanup(1)
  })


  process.on('SIGINT', () => {
    console.log('Received SIGINT, killing mocha process...')
    mochaProcess.kill('SIGINT')
    // cleanup will be called by mochaProcess.on('close') or 'exit'
  })

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, killing mocha process...')
    mochaProcess.kill('SIGTERM')
    // cleanup will be called by mochaProcess.on('close') or 'exit'
  })
})

