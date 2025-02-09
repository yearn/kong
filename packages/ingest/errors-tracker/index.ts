import { Processor } from 'lib/processor'
import { mq } from 'lib'
import { Queue, RedisClient, Worker } from 'bullmq'
import { q, bull } from 'lib/mq'
import { summarize } from './ai'

export const LOGS_REDIS_KEY = 'failed-logs-summarized'

export default class FailedLogInsights implements Processor {
  worker: Worker | undefined
  redis: RedisClient | undefined

  async up() {
    this.worker = new Worker(mq.q.logs, async (job) => {
      const label = `🍃 ${job.name} ${job.id}`
      console.time(label)
      const results = []
      for (const queueName of Object.keys(q)) {
        const queueInstance = new Queue(queueName, {
          connection: bull.connection,
        })

        if(!this.redis) {
          this.redis = await queueInstance.client
        }

        const failedJobs = await queueInstance.getJobs('failed', 0, 0, true)
        results.push(...failedJobs)
        await queueInstance.clean(0, 0, 'failed')
      }

      if(results.length === 0) {
        console.log('🍃', 'no failed jobs')
        return
      }

      const result = await summarize(results.map((r) => r.stacktrace).flat())

      await this.redis?.set(LOGS_REDIS_KEY, JSON.stringify(result))

      console.timeEnd(label)
    }, {
      concurrency: 1
    })
  }

  async down() {
    await Promise.all([this.worker?.close(), this.redis?.disconnect()])
  }
}
