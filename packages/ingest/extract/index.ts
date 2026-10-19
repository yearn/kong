import { mq } from 'lib'
import { Worker } from 'bullmq'
import { Processor } from 'lib/processor'
import { reportRetiredJob } from '../retired-jobs'
import { EvmLogsExtractor } from './evmlogs'
import { BlockExtractor } from './block'
import { SnapshotExtractor } from './snapshot'
import { TimeseriesExtractor } from './timeseries'
import { ManualsExtractor } from './manuals'
import { WebhookExtractor } from './webhook'

export default class Extract implements Processor {
  workers: Worker[] = []

  extractors = {
    [mq.job.extract.block.name]: new BlockExtractor(),
    [mq.job.extract.evmlog.name]: new EvmLogsExtractor(),
    [mq.job.extract.snapshot.name]: new SnapshotExtractor(),
    [mq.job.extract.timeseries.name]: new TimeseriesExtractor(),
    [mq.job.extract.manuals.name]: new ManualsExtractor(),
    [mq.job.extract.webhook.name]: new WebhookExtractor()
  }

  async up() {
    await removeLegacyBlockCrons()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = async (job: any) => {
      if (job.queueName === mq.q.extract && job.name === mq.job.extract.block.name && job.data?.chainId == null) {
        console.info('IGNORED_LEGACY_BLOCK_JOB', job.id)
        return
      }
      const extractor = Object.prototype.hasOwnProperty.call(this.extractors, job.name) ? this.extractors[job.name] : undefined
      if (!extractor) {
        if (job.name === 'waveydb') {
          reportRetiredJob('extract', job.name)
          return
        }
        throw new Error(`unknown extract job ${job.name}`)
      }
      const label = job.data.replay
        ? `🎭 ${job.name} ${job.id} ${job.data.chainId}`
        : `🛸 ${job.name} ${job.id} ${job.data.chainId}`
      console.time(label)
      try {
        await extractor.extract(job.data)
      } finally {
        console.timeEnd(label)
      }
    }
    this.workers = mq.workers(mq.q.extract, handler)
    this.workers.push(mq.worker(mq.q.extract, handler))
  }

  async down() {
    await Promise.all(this.workers.map(worker => worker.close()))
  }
}

// Old terminal versions registered LatestBlocks on the root queue without chainId.
// Remove only this obsolete repeatable; per-chain registrations remain intact.
export async function removeLegacyBlockCrons() {
  const queue = mq.connect(mq.q.extract)
  try {
    const repeatables = await queue.getRepeatableJobs()
    for (const repeatable of repeatables) {
      if (repeatable.name === mq.job.extract.block.name) {
        await queue.removeRepeatableByKey(repeatable.key)
        console.info('REMOVED_LEGACY_BLOCK_CRON', repeatable.key)
      }
    }
  } finally {
    await queue.close()
  }
}
