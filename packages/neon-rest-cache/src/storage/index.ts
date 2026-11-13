import type { Pool, PoolClient } from 'pg'

export interface Cache {
  getMany(keys: string[]): Promise<(string | null)[]>
  setMany(pairs: Array<[string, string]>, options?: { atomic?: boolean }): Promise<void>
}

export interface PostgresCacheOptions {
  job: string
  /** The active refresh invocation. Writes are staged under its fencing token. */
  generation?: string | number
  /** When true, getMany overlays this invocation's staged values over published data. */
  readStaging?: boolean
}

export interface RefreshOptions {
  job: string
  invocationId: string
  /** Scheduled slot identity; null for an explicitly requested/manual run. */
  scheduledAt?: Date | string | null
  leaseMs?: number
}

export type RefreshResult = 'success' | 'duplicate' | 'stale' | 'busy'

const DEFAULT_LEASE_MS = 5 * 60_000
const CLEANUP_LIMIT = 5_000

function assertName(value: string, label: string): void {
  if (!value || value.length > 512) throw new Error(`${label} must be 1–512 characters`)
}

function normalizeScheduledAt(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('scheduledAt must be a valid date')
  return date.toISOString()
}

async function transaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** A job-scoped cache. Values are stored exactly as supplied, typically JSON strings. */
export function createPostgresCache(pool: Pool, options: PostgresCacheOptions): Cache {
  assertName(options.job, 'job')
  const { job } = options
  const generation = options.generation == null ? null : String(options.generation)
  const readStaging = options.readStaging ?? generation !== null

  return {
    async getMany(keys) {
      if (keys.length === 0) return []
      const result = await pool.query<{ key: string; value: string | null }>(
        `WITH requested AS (
           SELECT key, ordinal FROM unnest($2::text[]) WITH ORDINALITY AS input(key, ordinal)
         ), current_job AS (
           SELECT published_generation FROM neon_rest_cache.jobs WHERE job = $1
         )
         SELECT requested.key,
                CASE WHEN staged.value IS NOT NULL THEN staged.value ELSE published.value END AS value
         FROM requested
         LEFT JOIN current_job ON true
         LEFT JOIN neon_rest_cache.entries AS published
           ON published.job = $1 AND published.generation = current_job.published_generation
          AND published.key = requested.key
         LEFT JOIN neon_rest_cache.entries AS staged
           ON $3::boolean AND $4::text IS NOT NULL
          AND staged.job = $1 AND staged.generation = $4 AND staged.key = requested.key
         ORDER BY requested.ordinal`,
        [job, keys, readStaging, generation],
      )
      return result.rows.map(row => row.value)
    },

    async setMany(pairs, setOptions = {}) {
      if (pairs.length === 0) return
      if (generation === null) throw new Error('setMany requires a generation; use runRefresh for writes')
      const keys = pairs.map(([key]) => key)
      const values = pairs.map(([, value]) => value)
      // One bulk statement is atomic itself. The lease row lock ensures an owner
      // cannot change between the fence check and this write.
      void setOptions // The bulk statement is atomic regardless of this hint.
      await transaction(pool, async client => {
        const owner = await client.query(
          `SELECT 1 FROM neon_rest_cache.jobs
           WHERE job = $1 AND lease_generation = $2
             AND lease_until > clock_timestamp() FOR UPDATE`,
          [job, generation],
        )
        if (owner.rowCount !== 1) throw new Error(`Refresh lease for ${job} was lost`)
        await client.query(
          `INSERT INTO neon_rest_cache.entries (job, generation, key, value)
           SELECT $1, $2, input.key, input.value
           FROM unnest($3::text[], $4::text[]) AS input(key, value)
           ON CONFLICT (job, generation, key) DO UPDATE SET value = EXCLUDED.value`,
          [job, generation, keys, values],
        )
      })
    },
  }
}

async function cleanup(pool: Pool, job: string, keepGeneration: string | null): Promise<void> {
  // Each invocation is bounded. Later refreshes continue trimming old generations.
  await pool.query(
    `DELETE FROM neon_rest_cache.entries
     WHERE ctid IN (
       SELECT entry.ctid FROM neon_rest_cache.entries AS entry
       JOIN neon_rest_cache.jobs AS current_job ON current_job.job = entry.job
       WHERE entry.job = $1
         AND entry.generation <> COALESCE($2, '')
         AND entry.generation <> COALESCE(current_job.published_generation, '')
         AND entry.generation <> COALESCE(current_job.previous_generation, '')
         AND entry.generation <> COALESCE(current_job.lease_generation, '')
       LIMIT $3
     )`,
    [job, keepGeneration, CLEANUP_LIMIT],
  )
  await pool.query(
    `DELETE FROM neon_rest_cache.runs
     WHERE ctid IN (
       SELECT ctid FROM neon_rest_cache.runs
       WHERE job = $1 AND status <> 'running'
       ORDER BY started_at DESC OFFSET 1000 LIMIT 1000
     )`,
    [job],
  )
}

export interface RefreshStatus {
  job: string
  publishedGeneration: string | null
  previousGeneration: string | null
  lastSuccessAt: Date | null
  lastSuccessScheduledAt: Date | null
  leaseUntil: Date | null
  latestRun: null | {
    invocationId: string
    scheduledAt: Date | null
    status: 'running' | 'success' | 'failed' | 'stale'
    startedAt: Date
    finishedAt: Date | null
  }
}

/** Read-only operator status for a single refresh job. */
export async function getRefreshStatus(pool: Pool, job: string): Promise<RefreshStatus | null> {
  const result = await pool.query<{
    job: string
    published_generation: string | null
    previous_generation: string | null
    last_success_at: Date | null
    last_success_scheduled_at: Date | null
    lease_until: Date | null
    invocation_id: string | null
    scheduled_at: Date | null
    status: 'running' | 'success' | 'failed' | 'stale'
    started_at: Date | null
    finished_at: Date | null
  }>(
    `SELECT jobs.job, jobs.published_generation, jobs.previous_generation,
            jobs.last_success_at, jobs.last_success_scheduled_at, jobs.lease_until,
            runs.invocation_id, runs.scheduled_at, runs.status,
            runs.started_at, runs.finished_at
     FROM neon_rest_cache.jobs AS jobs
     LEFT JOIN LATERAL (
       SELECT invocation_id, scheduled_at, status, started_at, finished_at
       FROM neon_rest_cache.runs WHERE job = jobs.job
       ORDER BY started_at DESC LIMIT 1
     ) AS runs ON true
     WHERE jobs.job = $1`,
    [job],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    job: row.job,
    publishedGeneration: row.published_generation,
    previousGeneration: row.previous_generation,
    lastSuccessAt: row.last_success_at,
    lastSuccessScheduledAt: row.last_success_scheduled_at,
    leaseUntil: row.lease_until,
    latestRun: row.invocation_id === null ? null : {
      invocationId: row.invocation_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      startedAt: row.started_at!,
      finishedAt: row.finished_at,
    },
  }
}

/** Read one key from the committed snapshot, bypassing any refresh staging. */
export async function inspectPublishedValue(pool: Pool, job: string, key: string): Promise<string | null> {
  const result = await pool.query<{ value: string | null }>(
    `SELECT entries.value FROM neon_rest_cache.jobs AS jobs
     LEFT JOIN neon_rest_cache.entries AS entries
       ON entries.job = jobs.job AND entries.generation = jobs.published_generation AND entries.key = $2
     WHERE jobs.job = $1`,
    [job, key],
  )
  return result.rows[0]?.value ?? null
}

/**
 * Runs a refresh with a renewable per-job lease. The callback writes to a private
 * generation; that generation becomes visible in one transaction only on success.
 */
export async function runRefresh(
  pool: Pool,
  options: RefreshOptions,
  run: (cache: Cache) => Promise<void>,
): Promise<RefreshResult> {
  const { job, invocationId } = options
  assertName(job, 'job')
  assertName(invocationId, 'invocationId')
  const scheduledAt = normalizeScheduledAt(options.scheduledAt)
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new Error('leaseMs must be at least 1000')

  const claim = await transaction(pool, async client => {
    await client.query(
      `INSERT INTO neon_rest_cache.jobs (job) VALUES ($1) ON CONFLICT (job) DO NOTHING`,
      [job],
    )
    const locked = await client.query<{
      published_generation: string | null
      last_success_scheduled_at: string | null
      lease_until: Date | null
      lease_generation: string | null
      lease_is_active: boolean
    }>(
      `SELECT published_generation, last_success_scheduled_at, lease_until, lease_generation,
              lease_until > clock_timestamp() AS lease_is_active
       FROM neon_rest_cache.jobs WHERE job = $1 FOR UPDATE`,
      [job],
    )
    const current = locked.rows[0]
    if (scheduledAt && current.last_success_scheduled_at) {
      const priorTime = new Date(current.last_success_scheduled_at).getTime()
      const candidateTime = new Date(scheduledAt).getTime()
      if (candidateTime === priorTime) return { result: 'duplicate' as const }
      if (candidateTime < priorTime) return { result: 'stale' as const }
    }
    if (current.lease_is_active) {
      return { result: 'busy' as const }
    }

    const sameInvocation = await client.query<{ status: string }>(
      `SELECT status FROM neon_rest_cache.runs WHERE job = $1 AND invocation_id = $2`,
      [job, invocationId],
    )
    if (sameInvocation.rows[0]?.status === 'success') return { result: 'duplicate' as const }

    const generation = await client.query<{ generation: string }>(
      `UPDATE neon_rest_cache.jobs
       SET lease_generation = (next_fence + 1)::text,
           next_fence = next_fence + 1,
           lease_invocation_id = $2,
           lease_scheduled_at = $3,
           lease_until = clock_timestamp() + ($4::bigint * interval '1 millisecond')
       WHERE job = $1
       RETURNING lease_generation AS generation`,
      [job, invocationId, scheduledAt, leaseMs],
    )
    await client.query(
      `INSERT INTO neon_rest_cache.runs (job, invocation_id, scheduled_at, generation, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', clock_timestamp())
       ON CONFLICT (job, invocation_id) DO UPDATE
         SET scheduled_at = EXCLUDED.scheduled_at, generation = EXCLUDED.generation,
             status = 'running', started_at = clock_timestamp(), finished_at = NULL`,
      [job, invocationId, scheduledAt, generation.rows[0].generation],
    )
    return { generation: generation.rows[0].generation, result: null }
  })
  if (claim.result) return claim.result

  const generation = claim.generation!
  const cache = createPostgresCache(pool, { job, generation, readStaging: true })
  let renewal: Promise<void> | null = null
  let leaseLost = false
  const timer = setInterval(() => {
    if (renewal) return
    renewal = (async () => {
      try {
        const result = await pool.query(
          `UPDATE neon_rest_cache.jobs
           SET lease_until = clock_timestamp() + ($3::bigint * interval '1 millisecond')
           WHERE job = $1 AND lease_generation = $2 AND lease_until > clock_timestamp()`,
          [job, generation, leaseMs],
        )
        if (result.rowCount !== 1) leaseLost = true
      } catch {
        leaseLost = true
      } finally {
        renewal = null
      }
    })()
  }, Math.max(500, Math.floor(leaseMs / 3)))

  try {
    await run(cache)
    clearInterval(timer)
    if (renewal) await renewal
    if (leaseLost) throw new Error(`Refresh lease for ${job} was lost before publication`)

    const published = await transaction(pool, async client => {
      const result = await client.query(
        `UPDATE neon_rest_cache.jobs
         SET published_generation = $2,
             previous_generation = published_generation,
             last_success_at = clock_timestamp(),
             last_success_scheduled_at = CASE WHEN $3::timestamptz IS NULL
               THEN last_success_scheduled_at ELSE $3::timestamptz END,
             lease_invocation_id = NULL, lease_scheduled_at = NULL,
             lease_generation = NULL, lease_until = NULL
         WHERE job = $1 AND lease_generation = $2 AND lease_until > clock_timestamp()`,
        [job, generation, scheduledAt],
      )
      if (result.rowCount !== 1) return false
      await client.query(
        `UPDATE neon_rest_cache.runs SET status = 'success', finished_at = clock_timestamp()
         WHERE job = $1 AND invocation_id = $2 AND generation = $3`,
        [job, invocationId, generation],
      )
      return true
    })
    if (!published) {
      throw new Error(`Refresh lease for ${job} expired before publication`)
    }
    await cleanup(pool, job, generation).catch(() => undefined)
    return 'success'
  } catch (error) {
    clearInterval(timer)
    if (renewal) await renewal
    await transaction(pool, async client => {
      await client.query(
        `UPDATE neon_rest_cache.runs SET status = 'failed', finished_at = clock_timestamp()
         WHERE job = $1 AND invocation_id = $2 AND generation = $3 AND status = 'running'`,
        [job, invocationId, generation],
      )
      await client.query(
        `UPDATE neon_rest_cache.jobs SET lease_invocation_id = NULL,
           lease_scheduled_at = NULL, lease_generation = NULL, lease_until = NULL
         WHERE job = $1 AND lease_generation = $2`,
        [job, generation],
      )
      await client.query(
        `DELETE FROM neon_rest_cache.entries AS entry
         USING neon_rest_cache.jobs AS current_job
         WHERE entry.job = $1 AND entry.generation = $2
           AND current_job.job = entry.job
           AND entry.generation IS DISTINCT FROM current_job.published_generation
           AND entry.generation IS DISTINCT FROM current_job.previous_generation`,
        [job, generation],
      )
    })
    throw error
  }
}
