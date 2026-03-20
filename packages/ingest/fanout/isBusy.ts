import { chains, mq } from 'lib'

export type BusyMatch = { queue: string; jobName: string; status: 'waiting' | 'active' }

type QueueSpec = { queueName: string; includedNames: Set<string> }

function buildQueueSpecs(): QueueSpec[] {
  const specs: QueueSpec[] = []

  // fanout queue: include events, timeseries (exclude abis)
  specs.push({
    queueName: mq.q.fanout,
    includedNames: new Set([mq.job.fanout.events.name, mq.job.fanout.timeseries.name])
  })

  // extract (root) queue: include manuals, waveydb, webhook
  specs.push({
    queueName: mq.q.extract,
    includedNames: new Set([mq.job.extract.manuals.name, mq.job.extract.waveydb.name, mq.job.extract.webhook.name])
  })

  // extract-{chainId} queues: include evmlog, snapshot, timeseries (exclude block)
  const perChainNames = new Set([
    mq.job.extract.evmlog.name,
    mq.job.extract.snapshot.name,
    mq.job.extract.timeseries.name
  ])
  for (const chain of chains) {
    specs.push({ queueName: `${mq.q.extract}-${chain.id}`, includedNames: perChainNames })
  }

  // load queue: include evmlog, snapshot, thing, output, price, monitor (exclude block)
  specs.push({
    queueName: mq.q.load,
    includedNames: new Set([
      mq.job.load.evmlog.name,
      mq.job.load.snapshot.name,
      mq.job.load.thing.name,
      mq.job.load.output.name,
      mq.job.load.price.name,
      mq.job.load.monitor.name
    ])
  })

  // probe queue: skip entirely

  return specs
}

export async function findBusyMatch(): Promise<BusyMatch | null> {
  const specs = buildQueueSpecs()

  for (const spec of specs) {
    const queue = mq.connect(spec.queueName)
    try {
      for (const status of ['waiting', 'active'] as const) {
        const PAGE = 100
        let start = 0
        while (true) {
          const jobs = await queue.getJobs([status], start, start + PAGE - 1)
          for (const job of jobs) {
            if (spec.includedNames.has(job.name)) {
              return { queue: spec.queueName, jobName: job.name, status }
            }
          }
          if (jobs.length < PAGE) break
          start += PAGE
        }
      }
    } finally {
      await queue.close()
    }
  }

  return null
}

export async function isBusy(): Promise<boolean> {
  return (await findBusyMatch()) !== null
}
