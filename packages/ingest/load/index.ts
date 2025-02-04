import { z } from 'zod'
import { mq, strider, types } from 'lib'
import db, { firstRow, getTravelledStrides, toUpsertSql } from '../db'
import { Processor } from 'lib/processor'
import { PoolClient } from 'pg'
import { OutputSchema, SnapshotSchema, ThingSchema, zhexstring } from 'lib/types'
import { Worker } from 'bullmq'
import { endOfDay } from 'lib/dates'

export default class Load implements Processor {
  worker: Worker | undefined

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

    [mq.job.load.output.name]: async data => data.batch
      ? await upsertBatchOutput(data.batch)
      : await upsertOutput(data),

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

export async function upsertEvmLog(data: any) {
  const { chainId, address, from, to, batch } = z.object({
    chainId: z.number(),
    address: zhexstring,
    from: z.bigint({ coerce: true }),
    to: z.bigint({ coerce: true }),
    batch: z.array(types.EvmLogSchema)
  }).parse(data)

  const client = await db.connect()
  try {
    await client.query('BEGIN')
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

    await client.query('COMMIT')
  } catch(error) {
    await client.query('ROLLBACK')
    throw error

  } finally {
    client.release()
  }
}

export async function upsertSnapshot(data: any) {
  const snapshot = SnapshotSchema.parse(data)
  const client = await db.connect()

  try {
    await client.query('BEGIN')
    const { snapshot: currentSnapshot, hook: currentHook } = (await firstRow(
      'SELECT snapshot, hook FROM snapshot WHERE chain_id = $1 AND address = $2 FOR UPDATE', 
      [snapshot.chainId, snapshot.address],
      client
    )) ?? { snapshot: {}, hook: {} }

    snapshot.snapshot = { ...currentSnapshot, ...snapshot.snapshot }
    snapshot.hook = { ...currentHook, ...snapshot.hook }
    await upsert(snapshot, 'snapshot', 'chain_id, address', undefined, client)

    await client.query('COMMIT')

  } catch(error) {
    await client.query('ROLLBACK')
    throw error

  } finally {
    client.release()
  }
}

export async function upsertThing(data: any) {
  const thing = ThingSchema.parse(data)
  const client = await db.connect()

  try {
    await client.query('BEGIN')
    const currentDefaults: any = (await client.query(
      'SELECT defaults FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3 FOR UPDATE',
      [thing.chainId, thing.address, thing.label]))
      .rows[0]?.defaults
    if (currentDefaults) thing.defaults = { ...currentDefaults, ...thing.defaults }
    await upsert(thing, 'thing', 'chain_id, address, label', undefined, client)
    await client.query('COMMIT')

  } catch(error) {
    await client.query('ROLLBACK')
    throw error

  } finally {
    client.release()
  }
}

export async function upsertOutput(data: any) {
  const output = { 
    ...OutputSchema.parse(data), 
    series_time: endOfDay(data.block_time) 
  }
  await upsert(output, 'output', 'chain_id, address, label, component, series_time')
}

export async function upsertBatchOutput(batch: any[]) {
  const outputs = OutputSchema.array().parse(batch).map(output => ({
    ...output, 
    series_time: endOfDay(output.blockTime)
  }))
  await upsertBatch(outputs, 'output', 'chain_id, address, label, component, series_time')
}

export async function upsert(data: any, table: string, pk: string, where?: string, _client?: PoolClient) {
  await (_client ?? db).query(
    toUpsertSql(table, pk, data, where),
    Object.values(data)
  )
}

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
