import { mq } from 'lib'
import { Worker } from 'bullmq'
import { Processor } from 'lib/processor'
import { EvmLogsExtractor } from './evmlogs'
import { BlockExtractor } from './block'
import { WaveyDbExtractor } from './waveydb'
import { SnapshotExtractor } from './snapshot'
import { TimeseriesExtractor } from './timeseries'
import { ManualsExtractor } from './manuals'
import { WebhookExtractor } from './webhook'

export default class Extract implements Processor {
  workers: Worker[] = []

  extractors = {
    [mq.job.extract.block.name]: new BlockExtractor(),
    [mq.job.extract.evmlog.name]: new EvmLogsExtractor(),
    [mq.job.extract.waveydb.name]: new WaveyDbExtractor(),
    [mq.job.extract.snapshot.name]: new SnapshotExtractor(),
    [mq.job.extract.timeseries.name]: new TimeseriesExtractor(),
    [mq.job.extract.manuals.name]: new ManualsExtractor(),
    [mq.job.extract.webhook.name]: new WebhookExtractor()
  }

  async up() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = async (job: any) => {
      const label = job.data.replay
        ? `🎭 ${job.name} ${job.id} ${job.data.chainId}`
        : `🛸 ${job.name} ${job.id} ${job.data.chainId}`
      console.time(label)
      await this.extractors[job.name].extract(job.data)
      console.timeEnd(label)
    }
    this.workers = mq.workers(mq.q.extract, handler)
    this.workers.push(mq.worker(mq.q.extract, handler))
  }

  async down() {
    await Promise.all(this.workers.map(worker => worker.close()))
  }
}
