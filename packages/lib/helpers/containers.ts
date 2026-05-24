import { GenericContainer, Network, Wait } from 'testcontainers'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer } from '@testcontainers/redis'
import type { StartedNetwork } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'
import { migrate } from 'db'
import path from 'path'
import dotenv from 'dotenv'

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

export interface ConfigOverrides {
  abis?: string
  chains?: string
  manuals?: string
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
  if (configs.abis) items.push({ content: configs.abis, target: '/app/config/abis.local.yaml' })
  if (configs.chains) items.push({ content: configs.chains, target: '/app/config/chains.local.yaml' })
  if (configs.manuals) items.push({ content: configs.manuals, target: '/app/config/manuals.local.yaml' })
  return items
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
      new PostgreSqlContainer('timescale/timescaledb:2.1.0-pg11')
        .withDatabase('user')
        .withUsername('user')
        .withPassword('password')
        .withExposedPorts(5432)
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

    // Set env for the host test process (for tests that import lib/db directly)
    process.env.POSTGRES_HOST = postgres.getHost()
    process.env.POSTGRES_PORT = String(postgres.getMappedPort(5432))
    process.env.POSTGRES_USER = 'user'
    process.env.POSTGRES_PASSWORD = 'password'
    process.env.POSTGRES_DATABASE = 'user'
    process.env.REDIS_HOST = redis.getHost()
    process.env.REDIS_PORT = String(redis.getMappedPort(6379))

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
      const image = await getIngestImage()

      let container = image
        .withNetwork(net)
        .withEnvironment({ ...serviceEnv, ...rpcEnv(), ...(opts.env || {}) })
        .withLogConsumer(stream => stream.on('data', (chunk: Buffer) => process.stdout.write(`[ingest] ${chunk}`)))
        .withWaitStrategy(Wait.forLogMessage('cron up SystemProbe'))
        .withStartupTimeout(240_000)

      const copies = contentsToCopy(configs)
      if (copies.length) container = container.withCopyContentToContainer(copies)

      this.ingestContainer = await container.start()
    }

    if (this.options.web) {
      const opts = this.options.web === true ? {} : this.options.web
      const configs = { ...sharedConfigs }
      const image = await getWebImage()

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
    }

    return {
      webUrl: this.webUrl,
      ingestContainer: this.ingestContainer,
      webContainer: this.webContainer,
    }
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
