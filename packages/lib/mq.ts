import { Queue, Worker } from 'bullmq'
import fs from 'fs'
import path from 'path'
import chains from './chains'
import { Job } from './types'

const MQ_INVENTORY = process.env.MQ_INVENTORY === 'true'
const MQ_INVENTORY_PATH = process.env.MQ_INVENTORY_PATH || path.resolve(process.cwd(), 'output/extract-1-inventory.csv')

export const q = {
  fanout: 'fanout',
  extract: 'extract',
  load: 'load',
  probe: 'probe'
}

export const job: { [queue: string]: { [job: string]: Job } } = {
  fanout: {
    abis: { queue: 'fanout', name: 'abis' },
    events: { queue: 'fanout', name: 'events' },
    timeseries: { queue: 'fanout', name: 'timeseries' }
  },

  extract: {
    block: { queue: 'extract', name: 'block', bychain: true },
    evmlog: { queue: 'extract', name: 'evmlog', bychain: true },
    snapshot: { queue: 'extract', name: 'snapshot', bychain: true },
    timeseries: { queue: 'extract', name: 'timeseries', bychain: true },
    waveydb: { queue: 'extract', name: 'waveydb' },
    manuals: { queue: 'extract', name: 'manuals' },
    webhook: { queue: 'extract', name: 'webhook' }
  },

  load: {
    block: { queue: 'load', name: 'block' },
    output: { queue: 'load', name: 'output' },
    monitor: { queue: 'load', name: 'monitor' },
    evmlog: { queue: 'load', name: 'evmlog' },
    snapshot: { queue: 'load', name: 'snapshot' },
    thing: { queue: 'load', name: 'thing' },
    price: { queue: 'load', name: 'price' }
  },

  probe: {
    all: { queue: 'probe', name: 'all' }
  }
}

// -= job priority in bullmq =-
// https://github.com/taskforcesh/bullmq/blob/a01bb0b0345509cde6c74843323de6b67729f310/docs/gitbook/guide/jobs/prioritized.md
// no priority set = highest (default)
// 1 = next highest
// 2 ** 21 = lowest
// adding prioritized jobs to a queue goes like O(log(n))
// where n is the number of prioritized jobs in the queue
// (ie, total jobs - non-prioritized jobs)
export const LOWEST_PRIORITY = 2 ** 21
const DEFAULT_PRIORITY = 100

const bull = { connection: {
  host: process.env.REDIS_HOST || 'localhost',
  port: (process.env.REDIS_PORT || 6379) as number,
  ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {})
}}

const queues: { [key: string]: Queue } = {}

export function connect(queueName: string) {
  return new Queue(queueName, bull)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function add(job: Job, data: any, options?: any) {
  const queue = job.bychain ? `${job.queue}-${data.chainId}` : job.queue
  if (MQ_INVENTORY && queue === 'extract-1') {
    try {
      fs.mkdirSync(path.dirname(MQ_INVENTORY_PATH), { recursive: true })
      if (!fs.existsSync(MQ_INVENTORY_PATH)) {
        fs.writeFileSync(MQ_INVENTORY_PATH, 'jobName,abiPath,address,chainId,fromBlock,toBlock,outputLabel\n')
      }
      const csvEscape = (v: unknown) => {
        const s = String(v ?? '')
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }
      const row = [
        job.name,
        data.abiPath ?? data.abi?.abiPath ?? '',
        data.address ?? data.source?.address ?? '',
        data.chainId ?? data.source?.chainId ?? '',
        data.from ?? data.fromBlock ?? '',
        data.to ?? data.toBlock ?? '',
        data.outputLabel ?? ''
      ].map(csvEscape).join(',')
      fs.appendFileSync(MQ_INVENTORY_PATH, row + '\n')
    } catch(error) {
      console.error('📋', 'inventory write failed', error)
    }
  }
  if (!queues[queue]) { queues[queue] = connect(queue) }
  return await queues[queue].add(job.name, data, { priority: DEFAULT_PRIORITY, attempts: 1, ...options })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workers(queueSuffix: string, handler: (job: any) => Promise<any>) {
  const result: Worker[] = []
  for (const chain of chains) { result.push(worker(`${queueSuffix}-${chain.id}`, handler, chain.id)) }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function worker(queueName: string, handler: (job: any) => Promise<any>, chainId?: number) {
  let concurrency = 1
  const queue = new Queue(queueName, bull)
  const worker = new Worker(queueName, async job => {
    try {
      await handler(job)
    } catch(error) {
      console.error('🤬', error)
      throw error
    }
  }, {
    ...bull,
    concurrency,
    removeOnComplete: {
      count: (process.env.MQ_REMOVE_ON_COMPLETE_COUNT ?? 100) as number,
      age: (process.env.MQ_REMOVE_ON_COMPLETE_AGE ?? 60 * 60) as number
    },
    removeOnFail: {
      count: (process.env.MQ_REMOVE_ON_FAIL_COUNT ?? 100) as number,
      age: (process.env.MQ_REMOVE_ON_FAIL_AGE ?? 15 * 60) as number
    }
  })

  const timer = setInterval(async () => {
    const MQ_CONCURRENCY_MAX_PER_PROCESSOR_ENVAR = chainId ? `MQ_CONCURRENCY_MAX_PER_PROCESSOR_${chainId}` : 'MQ_CONCURRENCY_MAX_PER_PROCESSOR'
    const MQ_CONCURRENCY_THRESHOLD_ENVAR = chainId ? `MQ_CONCURRENCY_THRESHOLD_${chainId}` : 'MQ_CONCURRENCY_THRESHOLD'
    const MQ_CONCURRENCY_MAX_PER_PROCESSOR = (process.env[MQ_CONCURRENCY_MAX_PER_PROCESSOR_ENVAR] || 50) as number
    const MQ_CONCURRENCY_THRESHOLD = (process.env[MQ_CONCURRENCY_THRESHOLD_ENVAR] || 200) as number

    const jobs = await queue.count()
    const targetConcurrency = computeConcurrency(jobs, {
      min: 1, max: MQ_CONCURRENCY_MAX_PER_PROCESSOR,
      threshold: MQ_CONCURRENCY_THRESHOLD
    })

    if(targetConcurrency > concurrency) {
      console.log('🚀', 'concurrency up', queueName, targetConcurrency)
      concurrency = targetConcurrency
      worker.concurrency = targetConcurrency

    } else if(targetConcurrency < concurrency) {
      console.log('🐌', 'concurrency down', queueName, targetConcurrency)
      concurrency = targetConcurrency
      worker.concurrency = targetConcurrency

    }
  }, 5000)

  const _close = worker.close.bind(worker)
  worker.close = async () => {
    clearInterval(timer)
    await queue.close()
    await _close()
  }

  console.log('😇', 'worker up', queueName)
  return worker
}

export interface ConcurrencyOptions {
  min: number
  max: number
  threshold: number
}

export function computeConcurrency(jobs: number, options: ConcurrencyOptions) {
  const m = (options.max - options.min) / (options.threshold - 0)
  const concurrency = Math.floor(m * jobs + options.min)
  return Math.min(Math.max(concurrency, options.min), options.max)
}

export async function down() {
  return Promise.all(Object.values(queues).map(async queue => queue.close()))
}

if (MQ_INVENTORY) {
  process.on('beforeExit', () => {
    if (!fs.existsSync(MQ_INVENTORY_PATH)) return
    const lines = fs.readFileSync(MQ_INVENTORY_PATH, 'utf-8').split('\n').filter(Boolean)
    const total = lines.length - 1 // exclude header
    if (total <= 0) return

    const byName: Record<string, number> = {}
    const byAbiPath: Record<string, number> = {}
    for (let i = 1; i < lines.length; i++) {
      const [jobName, abiPath] = lines[i].split(',')
      byName[jobName] = (byName[jobName] || 0) + 1
      if (abiPath) byAbiPath[abiPath] = (byAbiPath[abiPath] || 0) + 1
    }

    console.log(`\n📋 MQ Inventory Summary (extract-1): ${total} jobs`)
    console.log('  By jobName:')
    for (const [k, v] of Object.entries(byName).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}: ${v}`)
    }
    console.log('  By abiPath:')
    for (const [k, v] of Object.entries(byAbiPath).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}: ${v}`)
    }
    console.log(`  CSV written to: ${MQ_INVENTORY_PATH}\n`)
  })
}
