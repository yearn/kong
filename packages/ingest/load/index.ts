import { z } from 'zod'
import { mq, strider, types } from 'lib'
import db, { getTravelledStrides, invalidateSparkline, toUpsertSql, upsertThingDefaults, upsertSnapshotData } from '../db'
import { Processor } from 'lib/processor'
import { reportRetiredJob } from '../retired-jobs'
import { PoolClient } from 'pg'
import { OutputSchema, SnapshotSchema, ThingSchema, zhexstring } from 'lib/types'
import { Worker } from 'bullmq'
import { getAddress } from 'viem'
import { endOfDay } from 'lib/dates'

export default class Load implements Processor {
  worker: Worker | undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (data: any) => Promise<any>> = {
    [mq.job.load.block.name]: async data =>
      await upsert(data, 'latest_block', 'chain_id',
        'WHERE latest_block.block_number < EXCLUDED.block_number'
      ),

    [mq.job.load.monitor.name]: async data =>
      await upsert({ singleton: true, latest: data }, 'monitor', 'singleton'),

    [mq.job.load.evmlog.name]: async data =>
      await upsertEvmLog(data),

    [mq.job.load.snapshot.name]: async data =>
      await upsertSnapshot(data),

    [mq.job.load.thing.name]: async data =>
      await upsertThing(data),

    [mq.job.load.output.name]: async data =>
      await upsertBatchOutput(data.batch === undefined ? [data] : data.batch)
  }

  async up() {
    this.worker = mq.worker(mq.q.load, async job => {
      const label = `📀 ${job.name} ${job.id}`
      const handler = Object.prototype.hasOwnProperty.call(this.handlers, job.name) ? this.handlers[job.name] : undefined
      if (!handler) {
        if (job.name === 'price') {
          reportRetiredJob('load', job.name)
          return
        }
        throw new Error(`unknown load job ${job.name}`)
      }
      console.time(label)
      await handler(job.data)
      console.timeEnd(label)
    })
  }

  async down() {
    await this.worker?.close()
  }
}

export async function upsertEvmLog(data: object) {
  const { abiPath, chainId, address: rawAddress, from, to, batch, replay } = z.object({
    abiPath: z.string().min(1).optional(),
    chainId: z.number(),
    address: zhexstring,
    from: z.bigint({ coerce: true }),
    to: z.bigint({ coerce: true }),
    batch: z.array(types.EvmLogSchema),
    replay: z.boolean().optional()
  }).parse(data)

  const address = getAddress(rawAddress)
  // Replay jobs read logs already stored in Postgres. They must not claim the
  // whole replay window was fetched from the chain.
  const creditCoverage = Boolean(abiPath && !replay)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    // Serializes first inserts too, when no coverage row exists to lock yet.
    if (creditCoverage) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([chainId, address, abiPath])])
    await upsertBatch(batch, 'evmlog', 'chain_id, address, signature, block_number, log_index, transaction_hash', undefined, client)

    // Old queued payloads can save logs but cannot prove reader coverage.
    if (abiPath && creditCoverage) {
      const current = await getTravelledStrides(chainId, address, abiPath, client)
      const next = strider.add({ from, to }, current)
      await client.query(`
        INSERT INTO evmlog_reader_strides(chain_id, address, abi_path, strides)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (chain_id, address, abi_path)
        DO UPDATE SET strides = EXCLUDED.strides`,
      [chainId, address, abiPath, JSON.stringify(next)]
      )
    }
    await client.query('COMMIT')
  } catch(error) {
    await client.query('ROLLBACK')
    throw error

  } finally {
    client.release()
  }
}


export async function upsertSnapshot(data: object) {
  await upsertSnapshotData(SnapshotSchema.parse(data))
}

export async function upsertThing(data: object) {
  const thing = ThingSchema.parse(data)
  await upsertThingDefaults(thing)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertBatchOutput(batch: any[]) {
  const outputs = OutputSchema.array().parse(batch).map(output => ({
    ...output,
    series_time: endOfDay(output.blockTime)
  }))
  await upsertBatch(outputs, 'output', 'chain_id, address, label, component, series_time')
  for (const output of outputs) {
    invalidateSparkline(output.chainId, output.address, output.label, output.blockTime)
  }
}

export async function upsert(data: object, table: string, pk: string, where?: string, _client?: PoolClient) {
  await (_client ?? db).query(
    toUpsertSql(table, pk, data, where),
    Object.values(data)
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertBatch(batch: any[], table: string, pk: string, where?: string, _client?: PoolClient) {
  const client = _client ?? await db.connect()
  try {
    if(!_client) await client.query('BEGIN')
    for(const object of batch) {
      await client.query(
        toUpsertSql(table, pk, object, where),
        Object.values(object)
      )
    }
    if(!_client) await client.query('COMMIT')
  } catch (error) {
    if(!_client) await client.query('ROLLBACK')
    throw error
  } finally {
    if(!_client) client.release()
  }
}
