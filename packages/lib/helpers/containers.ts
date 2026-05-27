import { GenericContainer, Network, Wait } from 'testcontainers'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import type { StartedNetwork } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import { migrate } from 'db'
import path from 'path'
import dotenv from 'dotenv'
import { spawn } from 'child_process'
import { Pool } from 'pg'
import { Queue } from 'bullmq'
import { dump } from 'js-yaml'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const dotenvParsed = dotenv.config({ path: path.join(REPO_ROOT, '.env') }).parsed || {}

function rpcEnv(): Record<string, string> {
  const merged = { ...dotenvParsed, ...process.env }
  const result: Record<string, string> = {}
  const prefixes = ['HTTP_ARCHIVE_', 'HTTP_FULLNODE_', 'YDAEMON_', 'YPRICE_', 'PRICE_SERVICE_']
  for (const [k, v] of Object.entries(merged)) {
    if (v && prefixes.some(p => k.startsWith(p))) result[k] = v
  }
  return result
}

export interface AbiSource {
  chainId: number
  address: string
  inceptBlock: number
}

export interface AbiEntry {
  abiPath: string
  sources: AbiSource[]
}

export interface ManualEntry {
  chainId: number
  address: string
  label: string
  defaults?: Record<string, unknown>
}

export interface ConfigOverrides {
  chains?: string[]
  abis?: AbiEntry[]
  manuals?: ManualEntry[]
}

export interface IngestContainerOptions {
  configs?: ConfigOverrides
  env?: Record<string, string>
}

export interface WebContainerOptions {
  env?: Record<string, string>
}

export interface TestEnvironmentOptions {
  ingest?: boolean | IngestContainerOptions
  web?: boolean | WebContainerOptions
  configs?: ConfigOverrides
}

function contentsToCopy(configs: ConfigOverrides) {
  const items: { content: string; target: string }[] = []
  if (configs.chains)
    items.push({ content: dump({ chains: configs.chains }), target: '/app/config/chains.local.yaml' })
  if (configs.abis)
    items.push({
      content: dump({
        cron: { name: 'AbiFanout', queue: 'fanout', job: 'abis', schedule: '*/15 * * * *', start: false },
        abis: configs.abis,
      }),
      target: '/app/config/abis.local.yaml',
    })
  if (configs.manuals)
    items.push({ content: dump({ manuals: configs.manuals }), target: '/app/config/manuals.local.yaml' })
  return items
}

export function createTestPool(): Pool {
  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
  })
}

export async function pollForRow(
  pool: Pool,
  sql: string,
  params: unknown[],
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { rows } = await pool.query(sql, params)
    if (rows.length > 0) return
    await new Promise(r => setTimeout(r, 3_000))
  }
  throw new Error(`Row not found after ${timeoutMs}ms`)
}

export async function triggerFanout(
  jobName: string,
  data: Record<string, unknown>,
  jobId?: string,
): Promise<void> {
  const queue = new Queue('fanout', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT || 6379),
    },
  })
  await queue.add(jobName, data, jobId ? { jobId } : undefined)
  await queue.close()
}

// Build images once per process to leverage Docker layer cache
let ingestImage: Promise<GenericContainer> | null = null
let webImage: Promise<GenericContainer> | null = null

function getIngestImage(): Promise<GenericContainer> {
  return ingestImage ??= GenericContainer
    .fromDockerfile(REPO_ROOT, 'docker/ingest.Dockerfile')
    .build()
}

function getWebImage(): Promise<GenericContainer> {
  return webImage ??= GenericContainer
    .fromDockerfile(REPO_ROOT, 'docker/web.Dockerfile')
    .build()
}

export class TestEnvironment {
  private network: StartedNetwork | null = null
  private postgres: StartedTestContainer | null = null
  private redis: StartedTestContainer | null = null
  private ingestContainer: StartedTestContainer | null = null
  private webContainer: StartedTestContainer | null = null

  webUrl = ''

  constructor(private options: TestEnvironmentOptions = {}) {}

  async start() {
    this.network = await new Network().start()
    const net = this.network

    const [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('timescale/timescaledb:latest-pg16')
        .withDatabase('user')
        .withUsername('user')
        .withPassword('password')
        .withExposedPorts(5432)
        .withHealthCheck({
          test: ['CMD-SHELL', 'pg_isready -U user || exit 1'],
          interval: 2000,
          timeout: 5000,
          retries: 30,
          startPeriod: 10000,
        })
        .withWaitStrategy(Wait.forHealthCheck())
        .withNetwork(net)
        .withNetworkAliases('postgres')
        .start(),
      new RedisContainer('redis:latest')
        .withHealthCheck({
          test: ['CMD', 'redis-cli', 'ping'],
          interval: 1000,
          timeout: 5000,
          retries: 5,
        })
        .withWaitStrategy(Wait.forHealthCheck())
        .withNetwork(net)
        .withNetworkAliases('redis')
        .start(),
    ])
    this.postgres = postgres
    this.redis = redis

    await migrate({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'user',
      password: 'password',
      database: 'user',
    })
    console.log('[test-env] ✅ database migrated')

    // Set env for the host test process (for tests that import lib/db directly)
    process.env.POSTGRES_HOST = postgres.getHost()
    process.env.POSTGRES_PORT = String(postgres.getMappedPort(5432))
    process.env.POSTGRES_USER = 'user'
    process.env.POSTGRES_PASSWORD = 'password'
    process.env.POSTGRES_DATABASE = 'user'
    delete process.env.POSTGRES_SSL
    process.env.REDIS_HOST = redis.getHost()
    process.env.REDIS_PORT = String(redis.getMappedPort(6379))
    const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`
    process.env.REST_CACHE_REDIS_URL = redisUrl
    process.env.GQL_CACHE_REDIS_URL = redisUrl

    // Env for service containers — uses Docker network aliases, not localhost mapped ports
    const serviceEnv = {
      POSTGRES_HOST: 'postgres',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'user',
      POSTGRES_PASSWORD: 'password',
      POSTGRES_DATABASE: 'user',
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
    }

    const sharedConfigs = this.options.configs || {}

    if (this.options.ingest) {
      const opts = this.options.ingest === true ? {} : this.options.ingest
      const configs = { ...sharedConfigs, ...opts.configs }
      console.log('[test-env] 🔨 building ingest image (this may take a while on first run)...')
      const image = await getIngestImage()
      console.log('[test-env] ✅ ingest image ready')

      let container = image
        .withNetwork(net)
        .withEnvironment({ ...serviceEnv, ...rpcEnv(), ...(opts.env || {}) })
        .withLogConsumer(stream => stream.on('data', (chunk: Buffer) => process.stdout.write(`[ingest] ${chunk}`)))
        .withWaitStrategy(Wait.forLogMessage('cron up SystemProbe'))
        .withStartupTimeout(240_000)

      const copies = contentsToCopy(configs)
      if (copies.length) container = container.withCopyContentToContainer(copies)

      this.ingestContainer = await container.start()
      console.log('[test-env] ✅ ingest container started')
    }

    if (this.options.web) {
      const opts = this.options.web === true ? {} : this.options.web
      const configs = { ...sharedConfigs }
      console.log('[test-env] 🔨 building web image...')
      const image = await getWebImage()
      console.log('[test-env] ✅ web image ready')

      let container = image
        .withNetwork(net)
        .withExposedPorts(3001)
        .withEnvironment({
          ...serviceEnv,
          GQL_CACHE_REDIS_URL: 'redis://redis:6379',
          REST_CACHE_REDIS_URL: 'redis://redis:6379',
          ...(opts.env || {}),
        })
        .withLogConsumer(stream => stream.on('data', (chunk: Buffer) => process.stdout.write(`[web] ${chunk}`)))
        .withWaitStrategy(Wait.forLogMessage(/Ready/))
        .withStartupTimeout(180_000)

      const copies = contentsToCopy(configs)
      if (copies.length) container = container.withCopyContentToContainer(copies)

      this.webContainer = await container.start()
      this.webUrl = `http://localhost:${this.webContainer.getMappedPort(3001)}`
      console.log(`[test-env] ✅ web container started at ${this.webUrl}`)
    }

    return {
      webUrl: this.webUrl,
      ingestContainer: this.ingestContainer,
      webContainer: this.webContainer,
    }
  }

  runScript(scriptPath: string): Promise<void> {
    const abs = path.isAbsolute(scriptPath) ? scriptPath : path.join(REPO_ROOT, scriptPath)
    const tsNode = path.join(REPO_ROOT, 'node_modules/.bin/ts-node')
    const compilerOptions = JSON.stringify({ module: 'commonjs', moduleResolution: 'node', esModuleInterop: true })
    return new Promise((resolve, reject) => {
      let output = ''
      const proc = spawn(tsNode, ['--transpile-only', '--skip-project', '--compiler-options', compilerOptions, abs], {
        env: process.env,
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      proc.stdout?.on('data', (c: Buffer) => { process.stdout.write(c); output += c })
      proc.stderr?.on('data', (c: Buffer) => { process.stderr.write(c); output += c })
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`runScript(${path.basename(abs)}) exited ${code}:\n${output.slice(-3000)}`)))
    })
  }

  async stop() {
    await Promise.allSettled([
      this.ingestContainer?.stop(),
      this.webContainer?.stop(),
    ])
    await Promise.allSettled([
      this.postgres?.stop(),
      this.redis?.stop(),
    ])
    await this.network?.stop()
  }
}
