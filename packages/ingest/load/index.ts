import { z } from 'zod'
import { mq, strider, strings, types } from 'lib'
import db, { firstRow, getTravelledStrides, toBulkUpsertSql, toUpsertSql, upsertThingDefaults, withTransaction } from '../db'
import { Processor } from 'lib/processor'
import { PoolClient } from 'pg'
import { OutputSchema, SnapshotSchema, ThingSchema, zhexstring } from 'lib/types'
import { Worker } from 'bullmq'
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
      await upsertBatchOutput(data.batch),

    [mq.job.load.price.name]: async data => data.batch
      ? await upsertBatch(data.batch, 'price', 'chain_id, address, block_number')
      : await upsert(data, 'price', 'chain_id, address, block_number')
  }

  async up() {
    this.worker = mq.worker(mq.q.load, async job => {
      const label = `📀 ${job.name} ${job.id}`
      console.time(label)
      await this.handlers[job.name](job.data)
      console.timeEnd(label)
    })
  }

  async down() {
    await this.worker?.close()
  }
}

export async function upsertEvmLog(data: object) {
  const { chainId, address, from, to, batch } = z.object({
    chainId: z.number(),
    address: zhexstring,
    from: z.bigint({ coerce: true }),
    to: z.bigint({ coerce: true }),
    batch: z.array(types.EvmLogSchema)
  }).parse(data)

  await withTransaction(async client => {
    await upsertBatch(batch, 'evmlog', 'chain_id, address, signature, block_number, log_index, transaction_hash', undefined, client)

    const current = await getTravelledStrides(chainId, address, client)
    const next = strider.add({ from, to }, current)
    await client.query(`
      INSERT INTO evmlog_strides(chain_id, address, strides)
      VALUES ($1, $2, $3)
      ON CONFLICT (chain_id, address)
      DO UPDATE SET strides = $3`,
    [chainId, address, JSON.stringify(next)]
    )
  })
}


export async function upsertSnapshot(data: object) {
  const snapshot = SnapshotSchema.parse(data)

  await withTransaction(async client => {
    const { snapshot: currentSnapshot, hook: currentHook } = (await firstRow(
      'SELECT snapshot, hook FROM snapshot WHERE chain_id = $1 AND address = $2 FOR UPDATE',
      [snapshot.chainId, snapshot.address],
      client
    )) ?? { snapshot: {}, hook: {} }

    snapshot.snapshot = { ...currentSnapshot, ...snapshot.snapshot }

    snapshot.hook = {
      ...currentHook,
      ...snapshot.hook,
      meta: snapshot.hook.meta ? { ...currentHook.meta, ...JSON.parse(JSON.stringify(snapshot.hook.meta)) } : currentHook.meta
    }
    await upsert(snapshot, 'snapshot', 'chain_id, address', undefined, client)
  })
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
}

export async function upsert(data: object, table: string, pk: string, where?: string, _client?: PoolClient) {
  await (_client ?? db).query(
    toUpsertSql(table, pk, data, where),
    Object.values(data)
  )
}

const UPSERT_CHUNK = 500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertBatch(batch: any[], table: string, pk: string, where?: string, _client?: PoolClient) {
  const pkColumns = pk.split(',').map(column => column.trim())
  const rows = new Map<string, Record<string, unknown>>()
  for (const object of batch) {
    const row: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(object)) row[strings.camelToSnake(key)] = value
    const key = pkColumns.map(column => String(row[column])).join('\u0000')
    rows.set(key, { ...rows.get(key), ...row })
  }

  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows.values()) {
    const fields = Object.keys(row).sort().join(',')
    const group = groups.get(fields)
    if (group) group.push(row)
    else groups.set(fields, [row])
  }

  const run = async (client: PoolClient) => {
    for (const [fieldList, group] of groups) {
      const fields = fieldList.split(',')
      for (let i = 0; i < group.length; i += UPSERT_CHUNK) {
        const chunk = group.slice(i, i + UPSERT_CHUNK)
        await client.query(
          toBulkUpsertSql(table, pk, fields, chunk.length, where),
          chunk.flatMap(row => fields.map(field => row[field]))
        )
      }
    }
  }

  if (_client) await run(_client)
  else await withTransaction(run)
}
