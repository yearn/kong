import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Wait } from 'testcontainers'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getRuntime, setRuntimeForTests } from '../src/runtime.js'
import { createPostgresCache, runRefresh } from '../src/storage/index.js'

const migrationPath = resolve(import.meta.dirname, '../migrations/001-neon-rest-cache.sql')
const execFileAsync = promisify(execFile)

async function waitForSignal(signal: Promise<void>, worker: Promise<unknown>): Promise<void> {
  await Promise.race([
    signal,
    worker.then(() => { throw new Error('Refresh finished before reaching its test gate') }),
  ])
}

describe('Neon REST cache PostgreSQL storage', () => {
  let postgres: StartedPostgreSqlContainer
  let pool: Pool

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('cache_test')
      .withUsername('cache_test')
      .withPassword('cache_test')
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U cache_test -d cache_test || exit 1'],
        interval: 1000,
        timeout: 5000,
        retries: 30,
        startPeriod: 5000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .start()
    pool = new Pool({ connectionString: postgres.getConnectionUri() })
    await pool.query(await readFile(migrationPath, 'utf8'))
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
    if (postgres) {
      try {
        await postgres.stop()
      } catch {
        // Docker Desktop can report the container as running while its stop request
        // is still completing; force-remove it so Testcontainers leaves no residue.
        await execFileAsync('docker', ['rm', '-f', postgres.getId()])
      }
    }
  }, 30_000)

  it('keeps the published historical cache visible until a complete generation publishes', async () => {
    const job = 'atomic-publish'
    const historyKey = 'rest:timeseries:history:1:0xabc'

    expect(await runRefresh(pool, { job, invocationId: 'initial' }, async cache => {
      await cache.setMany([
        ['rest:list:vaults:all', 'old-list'],
        ['rest:tvl:all', 'old-tvl'],
        [historyKey, 'prior-history'],
      ])
    })).toBe('success')

    let releaseStaged!: () => void
    let signalStaged!: () => void
    const staged = new Promise<void>(resolve => { signalStaged = resolve })
    const publishGate = new Promise<void>(resolve => { releaseStaged = resolve })
    const nextRefresh = runRefresh(
      pool,
      { job, invocationId: 'next', scheduledAt: '2026-11-12T00:00:00Z' },
      async cache => {
        await cache.setMany([
          ['rest:list:vaults:all', 'new-list'],
          ['rest:tvl:all', 'new-tvl'],
        ])
        signalStaged()
        await publishGate
      },
    )

    await waitForSignal(staged, nextRefresh)
    try {
      expect(await createPostgresCache(pool, { job }).getMany([
        'rest:list:vaults:all', 'rest:tvl:all', historyKey,
      ])).toEqual(['old-list', 'old-tvl', 'prior-history'])
    } finally {
      releaseStaged()
    }
    expect(await nextRefresh).toBe('success')
    expect(await createPostgresCache(pool, { job }).getMany([
      'rest:list:vaults:all', 'rest:tvl:all', historyKey,
    ])).toEqual(['new-list', 'new-tvl', null])
  })

  it('rejects duplicate and out-of-order scheduled slots without running or overwriting data', async () => {
    const job = 'ordered-slots'
    const latest = '2026-11-12T00:00:00Z'
    expect(await runRefresh(pool, { job, invocationId: 'latest', scheduledAt: latest }, async cache => {
      await cache.setMany([['value', 'latest']])
    })).toBe('success')

    let ran = false
    expect(await runRefresh(pool, { job, invocationId: 'duplicate', scheduledAt: latest }, async () => {
      ran = true
    })).toBe('duplicate')
    expect(await runRefresh(pool, {
      job,
      invocationId: 'out-of-order',
      scheduledAt: '2026-11-11T23:30:00Z',
    }, async () => {
      ran = true
    })).toBe('stale')

    expect(ran).toBe(false)
    expect(await createPostgresCache(pool, { job }).getMany(['value'])).toEqual(['latest'])
  })

  it('keeps the last published generation when a refresh fails', async () => {
    const job = 'failed-refresh'
    expect(await runRefresh(pool, { job, invocationId: 'good' }, async cache => {
      await cache.setMany([['value', 'last-good']])
    })).toBe('success')

    await expect(runRefresh(pool, { job, invocationId: 'bad' }, async cache => {
      await cache.setMany([['value', 'partial'], ['another', 'partial']])
      throw new Error('simulated refresh failure')
    })).rejects.toThrow('simulated refresh failure')

    expect(await createPostgresCache(pool, { job }).getMany(['value', 'another']))
      .toEqual(['last-good', null])
    const run = await pool.query<{ status: string }>(
      'SELECT status FROM neon_rest_cache.runs WHERE job = $1 AND invocation_id = $2',
      [job, 'bad'],
    )
    expect(run.rows[0]?.status).toBe('failed')
  })

  it('preserves a committed generation if post-publish cleanup fails', async () => {
    const job = 'cleanup-failure'
    for (const [invocationId, value] of [['first', 'first'], ['second', 'second']] as const) {
      expect(await runRefresh(pool, { job, invocationId }, async cache => {
        await cache.setMany([['value', value]])
      })).toBe('success')
    }

    await pool.query(`
      CREATE FUNCTION neon_rest_cache.fail_cleanup_for_test() RETURNS trigger AS $$
      BEGIN
        IF OLD.job = 'cleanup-failure' THEN RAISE EXCEPTION 'simulated cleanup failure'; END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_cleanup_for_test
      BEFORE DELETE ON neon_rest_cache.entries
      FOR EACH ROW EXECUTE FUNCTION neon_rest_cache.fail_cleanup_for_test();
    `)
    try {
      expect(await runRefresh(pool, { job, invocationId: 'third' }, async cache => {
        await cache.setMany([['value', 'third']])
      })).toBe('success')

      expect(await createPostgresCache(pool, { job }).getMany(['value'])).toEqual(['third'])
      const generations = await pool.query<{ published_generation: string; previous_generation: string }>(
        'SELECT published_generation, previous_generation FROM neon_rest_cache.jobs WHERE job = $1',
        [job],
      )
      expect(generations.rows[0]?.published_generation).toBeTruthy()
      expect(generations.rows[0]?.previous_generation).toBeTruthy()
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS fail_cleanup_for_test ON neon_rest_cache.entries;
        DROP FUNCTION IF EXISTS neon_rest_cache.fail_cleanup_for_test();
      `)
    }
  })

  it('fences an expired worker after a newer lease publishes', async () => {
    const job = 'fenced-refresh'
    expect(await runRefresh(pool, { job, invocationId: 'initial' }, async cache => {
      await cache.setMany([['value', 'initial']])
    })).toBe('success')

    let releaseOld!: () => void
    let signalOldStarted!: () => void
    const oldStarted = new Promise<void>(resolve => { signalOldStarted = resolve })
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve })
    const oldWorker = runRefresh(
      pool,
      { job, invocationId: 'expired-worker', leaseMs: 1_000 },
      async cache => {
        await cache.setMany([['value', 'stale-worker']])
        signalOldStarted()
        await oldGate
      },
    )

    await waitForSignal(oldStarted, oldWorker)
    try {
      expect(await runRefresh(pool, { job, invocationId: 'overlap' }, async () => {})).toBe('busy')
      await pool.query(
        `UPDATE neon_rest_cache.jobs
         SET lease_until = clock_timestamp() - interval '1 second' WHERE job = $1`,
        [job],
      )
      expect(await runRefresh(pool, { job, invocationId: 'replacement' }, async cache => {
        await cache.setMany([['value', 'replacement']])
      })).toBe('success')
    } finally {
      releaseOld()
    }
    await expect(oldWorker).rejects.toThrow(/lease .*?(lost|expired)/i)
    expect(await createPostgresCache(pool, { job }).getMany(['value'])).toEqual(['replacement'])
  }, 15_000)

  it('keeps the source database timestamptz parser in epoch seconds', async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL
    const originalSourceDatabaseUrl = process.env.SOURCE_DATABASE_URL
    process.env.DATABASE_URL = postgres.getConnectionUri()
    delete process.env.SOURCE_DATABASE_URL

    const runtime = getRuntime()
    try {
      const result = await runtime.sourceDb.query<{ timestamp: bigint }>(
        `SELECT '2026-11-12T01:02:03Z'::timestamptz AS timestamp`,
      )
      expect(result.rows[0]?.timestamp).toBe(BigInt(Date.parse('2026-11-12T01:02:03Z') / 1000))
    } finally {
      setRuntimeForTests(undefined)
      await Promise.all([...new Set([runtime.cachePool, runtime.sourceDb])].map(pool => pool.end()))
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalDatabaseUrl
      if (originalSourceDatabaseUrl === undefined) delete process.env.SOURCE_DATABASE_URL
      else process.env.SOURCE_DATABASE_URL = originalSourceDatabaseUrl
    }
  })
})
