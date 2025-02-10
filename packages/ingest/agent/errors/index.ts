import { Queue, RedisClient } from 'bullmq'
import { q, bull } from 'lib/mq'
import { summarize } from './ai'

export const LOGS_REDIS_KEY = 'failed-logs-summarized'

export class ErrorsAgent {
  redis: RedisClient | undefined
  async act() {
    console.log('🤖', 'ErrorsAgent.act()')
    // const results = []
    // for (const queueName of Object.keys(q)) {
    //   const queueInstance = new Queue(queueName, {
    //     connection: bull.connection,
    //   })

    //   if(!this.redis) {
    //     this.redis = await queueInstance.client
    //   }

    //   const failedJobs = await queueInstance.getJobs('failed', 0, 0, true)
    //   results.push(...failedJobs)
    //   await queueInstance.clean(0, 0, 'failed')
    // }

    // if(results.length === 0) {
    //   console.log('🍃', 'no failed jobs')
    //   return
    // }

    // const result = await summarize(results.map((r) => r.stacktrace).flat())

    // await this.redis?.set(LOGS_REDIS_KEY, JSON.stringify(result))
  }
}
