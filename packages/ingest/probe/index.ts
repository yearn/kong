import os from 'os'
import { chains, mq } from 'lib'
import { Queue, Worker } from 'bullmq'
import { Processor } from 'lib/processor'
import { parse as parseRedisRaw } from 'redis-info'
import db from '../db'

export interface ProbeResults {
  queues: {
    name: string
    waiting: number
    active: number
    failed: number
  }[]

  db: {
    databaseSize: number
    indexHitRate: number
    cacheHitRate: number
    clients: number
  }

  redis: {
    version: string
    mode: string
    os: string
    uptime: number
    clients: number
    memory: {
      total: number
      used: number
      peak: number
      fragmentation: number
    }
  }

  ingest: {
    cpu: {
      usage: number
    }
    memory: {
      total: number
      used: number
    }
  }

  stats: {
    total: number
    endorsed: number
    experimental: number
    networks: {
      chainId: number
      count: number
    }[]
    apetax: {
      stealth: number
      new: number
      active: number
      withdraw: number
    }
  }
}

export default class Probe implements Processor {
  private worker: Worker | undefined
  private queues: { [key: string]: Queue } = {}

  async up() {
    this.queues[mq.q.fanout] = mq.connect(mq.q.fanout)
    this.queues[mq.q.extract] = mq.connect(mq.q.extract)
    for (const chain of chains) {
      this.queues[`${mq.q.extract}-${chain.id}`] = mq.connect(`${mq.q.extract}-${chain.id}`)
    }
    this.queues[mq.q.load] = mq.connect(mq.q.load)

    this.worker = mq.worker(mq.q.probe, async job => {
      const label = `👽 ${job.name} ${job.id}`
      console.time(label)

      await mq.add(mq.job.load.monitor, {
        ...await this.probeQueues(),
        ...await this.probeDb(),
        ...await this.probeIngest(),
        ...await this.probeIndexStats()
      })

      console.timeEnd(label)
    })
  }

  async down() {
    await this.worker?.close()
    await Promise.all(Object.values(this.queues).map(q => q.close()))
  }

  private async probeDb() {
    const query = `
      SELECT 'databaseSize' as property, pg_database_size($1) as value
      UNION SELECT 'clients', count(*) FROM pg_stat_activity
      UNION SELECT 
        'cacheHitRate',
        ROUND(SUM(heap_blks_hit) / (SUM(heap_blks_hit) + SUM(heap_blks_read)), 4) AS value
      FROM 
        pg_statio_user_tables
      UNION SELECT 
        'indexHitRate',
        ROUND(SUM(idx_blks_hit) / (SUM(idx_blks_hit) + SUM(idx_blks_read)), 4)
      FROM 
        pg_statio_user_indexes;`
    const dbStatusRows = (await db.query(query, [process.env.POSTGRES_DATABASE || 'user'])).rows

    const result: { [key: string]: any } = {}
    for (const row of dbStatusRows) result[row.property] = row.value
    return { db: result}
  }

  private async probeQueues() {
    const result = {
      queues: [] as ProbeResults['queues'],
      redis: {} as ProbeResults['redis']
    }

    for(const queue of Object.values(this.queues)) {
      result.queues.push({
        name: queue.name,
        waiting: await queue.count(),
        active: (await queue.getJobs('active')).length,
        failed: (await queue.getJobs('failed')).length
      })
    }

    const redisClient = await Object.values(this.queues)[0].client
    const rawRedis = await redisClient.info()
    const redisInfo = parseRedisRaw(rawRedis)

    result.redis = {
      version: redisInfo.redis_version,
      mode: redisInfo.redis_mode,
      os: redisInfo.os,
      uptime: +redisInfo.uptime_in_seconds,
      clients: +redisInfo.connected_clients,
      memory: {
        total: +redisInfo.maxmemory,
        used: +redisInfo.used_memory,
        peak: +redisInfo.used_memory_peak,
        fragmentation: +redisInfo.mem_fragmentation_ratio
      }
    }

    return result
  }

  private async probeIngest() {
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
  
    const cpus = os.cpus()
    let totalIdle = 0, totalTick = 0
    cpus.forEach(cpu => {
      totalTick += Object.values(cpu.times).reduce((a, b) => a + b, 0)
      totalIdle += cpu.times.idle
    })
  
    const idle = totalIdle / cpus.length
    const total = totalTick / cpus.length
    const usage = (total - idle) / total
  
    return {
      ingest: {
        cpu: { usage },
        memory: {
          total: totalMemory,
          used: usedMemory
        }
      }
    }
  }

  private async fetchThingLabels() {
    const query = `SELECT DISTINCT label FROM thing;`
    return (await db.query(query)).rows.map(row => row.label)
  }

  private async fetchTotals() {
    const labels = await this.fetchThingLabels()
    const query = `
    WITH counts AS ( SELECT 
      (SELECT count(*) FROM thing)::int AS thing_total,
      ${labels.map(label => `(SELECT count(*) FROM thing WHERE label = '${label}')::int AS thing_${label}_total,`).join('\n')}
      (SELECT count(*) FROM output)::int AS output_total,
      (SELECT count(*) FROM evmlog)::int AS evmlog_total
    )
    SELECT * FROM counts;`
    return (await db.query(query)).rows[0]
  }

  private async fetchEventCounts() {
    const query = `SELECT event_name, count(*) FROM evmlog GROUP BY event_name ORDER BY count DESC;`
    return (await db.query(query)).rows
  }

  private async probeIndexStats() {
    return { indexStats: {
      ...await this.fetchTotals(),
      eventCounts: await this.fetchEventCounts()
    }}
  }
}
