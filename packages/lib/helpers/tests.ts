import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { GenericContainer, Network, StartedNetwork, StartedTestContainer, Wait } from 'testcontainers'
import * as yaml from 'js-yaml'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Queue } from 'bullmq'
import { migrate } from 'db'

export const Postgres = new PostgreSqlContainer('timescale/timescaledb:2.1.0-pg11')
  .withDatabase('user')
  .withUsername('user')
  .withPassword('password')
  .withExposedPorts(5432)

export const Redis = new RedisContainer('redis:latest').withHealthCheck({
  test: ['CMD', 'redis-cli', 'ping'],
  interval: 1000,
  timeout: 5000,
  retries: 5,
}).withWaitStrategy(Wait.forHealthCheck()).withExposedPorts(6379)


export const dbMigrate = async ({ postgres }: { postgres: StartedPostgreSqlContainer}) => {
  await migrate({
    host: postgres.getHost(),
    port: postgres.getPort(),
    user: postgres.getUsername(),
    password: postgres.getPassword(),
    database: postgres.getDatabase()
  })
}

export function setTestcontainersEnv({ postgres, redis }: { postgres: StartedPostgreSqlContainer, redis: StartedRedisContainer }) {
  process.env.POSTGRES_HOST = postgres.getHost()
  process.env.POSTGRES_PORT = postgres.getPort().toString()
  process.env.POSTGRES_USER = postgres.getUsername()
  process.env.POSTGRES_PASSWORD = postgres.getPassword()
  process.env.POSTGRES_DB = postgres.getDatabase()
  process.env.REDIS_HOST = redis.getHost()
  process.env.REDIS_PORT = redis.getMappedPort(6379).toString()
  return {
    host: postgres.getHost(),
    port: postgres.getPort(),
    user: postgres.getUsername(),
    password: postgres.getPassword(),
    database: postgres.getDatabase(),
    redisHost: redis.getHost(),
    redisPort: redis.getMappedPort(6379).toString()
  }
}

// -- Stack: postgres + redis + ingest + web in a shared network ---------------

export interface AbiCronConfig {
  name?: string
  queue?: string
  job?: string
  schedule?: string
  start?: boolean
}

export interface StackConfig {
  abis: { cron?: AbiCronConfig, abis: object[] }
  manuals?: object
  chains?: { chains: string[] }
  env?: Record<string, string>
  imageTags?: { ingest?: string, web?: string }
  webPort?: number
  startupTimeoutMs?: number
}

export class Stack {
  network!: StartedNetwork
  postgres!: StartedPostgreSqlContainer
  redis!: StartedRedisContainer
  ingest!: StartedTestContainer
  web!: StartedTestContainer
  configDir!: string
  webUrl!: string
  chainIds: number[] = []

  static async start(cfg: StackConfig): Promise<Stack> {
    const repoRoot = path.resolve(__dirname, '../../..')
    const stack = new Stack()
    const startupTimeoutMs = cfg.startupTimeoutMs ?? 180_000

    stack.configDir = await prepareConfigDir(repoRoot, cfg)
    stack.chainIds = resolveChainIds(repoRoot, cfg)

    stack.network = await new Network().start()

    stack.postgres = await new PostgreSqlContainer('timescale/timescaledb:2.1.0-pg11')
      .withDatabase('user').withUsername('user').withPassword('password')
      .withExposedPorts(5432)
      .withNetwork(stack.network).withNetworkAliases('postgres')
      .withStartupTimeout(startupTimeoutMs)
      .start()

    stack.redis = await new RedisContainer('redis:latest')
      .withHealthCheck({ test: ['CMD', 'redis-cli', 'ping'], interval: 1000, timeout: 5000, retries: 5 })
      .withWaitStrategy(Wait.forHealthCheck())
      .withExposedPorts(6379)
      .withNetwork(stack.network).withNetworkAliases('redis')
      .withStartupTimeout(startupTimeoutMs)
      .start()

    await migrate({
      host: stack.postgres.getHost(), port: stack.postgres.getPort(),
      user: 'user', password: 'password', database: 'user'
    })

    const sharedEnv: Record<string, string> = {
      POSTGRES_HOST: 'postgres', POSTGRES_PORT: '5432',
      POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'password', POSTGRES_DATABASE: 'user',
      REDIS_HOST: 'redis', REDIS_PORT: '6379',
      REST_CACHE_REDIS_URL: 'redis://redis:6379',
      ...(cfg.env || {})
    }

    const ingestTag = cfg.imageTags?.ingest ?? 'kong-ingest:test'
    const webTag = cfg.imageTags?.web ?? 'kong-web:test'

    const ingestImage = await GenericContainer
      .fromDockerfile(repoRoot, 'packages/ingest/Dockerfile')
      .build(ingestTag, { deleteOnExit: false })

    const webImage = await GenericContainer
      .fromDockerfile(repoRoot, 'packages/web/Dockerfile')
      .build(webTag, { deleteOnExit: false })

    stack.ingest = await ingestImage
      .withNetwork(stack.network).withNetworkAliases('ingest')
      .withEnvironment(sharedEnv)
      .withBindMounts([{ source: stack.configDir, target: '/app/config', mode: 'ro' }])
      .withWaitStrategy(Wait.forLogMessage(/cron up SystemProbe/))
      .withStartupTimeout(startupTimeoutMs)
      .start()

    const webPort = cfg.webPort ?? 3000
    stack.web = await webImage
      .withNetwork(stack.network).withNetworkAliases('web')
      .withEnvironment(sharedEnv)
      .withBindMounts([{ source: stack.configDir, target: '/app/config', mode: 'ro' }])
      .withExposedPorts(webPort)
      .withWaitStrategy(Wait.forHttp('/api/gql', webPort).forStatusCode(400))
      .withStartupTimeout(startupTimeoutMs)
      .start()

    stack.webUrl = `http://${stack.web.getHost()}:${stack.web.getMappedPort(webPort)}`
    return stack
  }

  async fanoutAbis(args: string[] = []): Promise<void> {
    const res = await this.ingest.exec(['bun', 'packages/ingest/fanout-cli.ts', 'abis', ...args])
    if (res.exitCode !== 0) throw new Error(`fanoutAbis exit=${res.exitCode}: ${res.output}`)
  }

  async fanout(cmd: 'abis' | 'replays' | 'manuals' | 'waveydb', args: string[] = []): Promise<void> {
    const res = await this.ingest.exec(['bun', 'packages/ingest/fanout-cli.ts', cmd, ...args])
    if (res.exitCode !== 0) throw new Error(`fanout ${cmd} exit=${res.exitCode}: ${res.output}`)
  }

  async waitIdle(timeoutMs = 120_000, pollMs = 1000): Promise<void> {
    const connection = { host: this.redis.getHost(), port: this.redis.getMappedPort(6379) }
    const baseQueues = ['fanout', 'extract', 'load', 'probe']
    const queueNames = new Set<string>(baseQueues)
    for (const id of this.chainIds) {
      queueNames.add(`extract-${id}`)
    }

    const queues = [...queueNames].map(n => new Queue(n, { connection }))
    const start = Date.now()
    try {
      while (Date.now() - start < timeoutMs) {
        const counts = await Promise.all(queues.map(q => q.getJobCounts('waiting', 'active', 'delayed', 'prioritized')))
        const total = counts.reduce((s, c) => s + (c.waiting || 0) + (c.active || 0) + (c.delayed || 0) + (c.prioritized || 0), 0)
        if (total === 0) return
        await new Promise(r => setTimeout(r, pollMs))
      }
      throw new Error(`waitIdle timeout after ${timeoutMs}ms`)
    } finally {
      await Promise.all(queues.map(q => q.close()))
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { Pool } = await import('pg')
    const pool = new Pool({
      host: this.postgres.getHost(),
      port: this.postgres.getPort(),
      user: 'user', password: 'password', database: 'user'
    })
    try {
      const res = await pool.query(sql, params)
      return res.rows as T[]
    } finally {
      await pool.end()
    }
  }

  async fetch(p: string, init?: RequestInit): Promise<Response> {
    return await fetch(`${this.webUrl}${p}`, init)
  }

  async gql<T = unknown>(query: string, variables?: object): Promise<{ data?: T, errors?: object[] }> {
    const res = await this.fetch('/api/gql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
    return await res.json() as { data?: T, errors?: object[] }
  }

  async stop(): Promise<void> {
    await Promise.allSettled([
      this.web?.stop(),
      this.ingest?.stop(),
      this.redis?.stop(),
      this.postgres?.stop(),
    ])
    await this.network?.stop().catch(() => undefined)
    if (this.configDir) {
      await fs.promises.rm(this.configDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function prepareConfigDir(repoRoot: string, cfg: StackConfig): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kong-stack-'))
  const srcConfig = path.join(repoRoot, 'config')

  await fs.promises.cp(srcConfig, dir, { recursive: true })

  const abisLocal = path.join(dir, 'abis.local.yaml')
  fs.writeFileSync(abisLocal, yaml.dump({
    cron: {
      name: cfg.abis.cron?.name ?? 'AbiFanout',
      queue: cfg.abis.cron?.queue ?? 'fanout',
      job: cfg.abis.cron?.job ?? 'abis',
      schedule: cfg.abis.cron?.schedule ?? '*/15 * * * *',
      start: cfg.abis.cron?.start ?? false
    },
    abis: cfg.abis.abis
  }))

  if (cfg.manuals !== undefined) {
    fs.writeFileSync(path.join(dir, 'manuals.local.yaml'), yaml.dump(cfg.manuals))
  } else if (!fs.existsSync(path.join(dir, 'manuals.local.yaml'))) {
    fs.writeFileSync(path.join(dir, 'manuals.local.yaml'), yaml.dump({ manuals: [] }))
  }

  if (cfg.chains !== undefined) {
    fs.writeFileSync(path.join(dir, 'chains.local.yaml'), yaml.dump(cfg.chains))
  } else if (!fs.existsSync(path.join(dir, 'chains.local.yaml'))) {
    fs.writeFileSync(path.join(dir, 'chains.local.yaml'), yaml.dump({ chains: ['mainnet'] }))
  }

  return dir
}

function resolveChainIds(repoRoot: string, cfg: StackConfig): number[] {
  const names = cfg.chains?.chains ?? readChainsFromYaml(repoRoot)
  const idByName: Record<string, number> = {
    mainnet: 1, optimism: 10, gnosis: 100, polygon: 137, sonic: 146,
    fantom: 250, base: 8453, arbitrum: 42161, bera: 80094, katana: 747474
  }
  return names.map(n => idByName[n]).filter((id): id is number => typeof id === 'number')
}

function readChainsFromYaml(repoRoot: string): string[] {
  const local = path.join(repoRoot, 'config', 'chains.local.yaml')
  const prod = path.join(repoRoot, 'config', 'chains.yaml')
  const file = fs.existsSync(local) ? local : prod
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { chains: string[] }
  return parsed?.chains ?? ['mainnet']
}
