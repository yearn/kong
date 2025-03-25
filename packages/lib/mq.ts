import { Queue, Worker } from 'bullmq'
import { Job } from './types'
import chains from './chains'

export const q = {
  fanout: 'fanout',
  extract: 'extract',
  load: 'load',
  probe: 'probe',
  agent: 'agent'
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
    manuals: { queue: 'extract', name: 'manuals' }
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
  },

  agent: {
    errors: { queue: 'agent', name: 'errors' }
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

export const bull = { connection: {
  host: process.env.REDIS_HOST || 'localhost',
  port: (process.env.REDIS_PORT || 6379) as number,
}}

const queues: { [key: string]: Queue } = {}

export function connect(queueName: string) {
  return new Queue(queueName, bull)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function add(job: Job, data: any, options?: any) {
  const queue = job.bychain ? `${job.queue}-${data.chainId}` : job.queue
  if (!queues[queue]) { queues[queue] = connect(queue) }
  await queues[queue].add(job.name, data, { priority: DEFAULT_PRIORITY, ...options })
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
