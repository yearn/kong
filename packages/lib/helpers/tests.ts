import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis'
import { Wait } from 'testcontainers'
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
