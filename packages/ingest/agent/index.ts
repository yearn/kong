import { Processor } from 'lib/processor'
import { mq } from 'lib'
import { Worker } from 'bullmq'
import { ErrorsAgent } from './errors'

export default class Agent implements Processor {
  worker: Worker | undefined

  agents = {
    [mq.job.agent.errors.name]: new ErrorsAgent()
  }

  async up() {
    this.worker = new Worker(mq.q.agent, async (job) => {
      const label = `🤖 ${job.name} ${job.id}`
      console.time(label)
      await this.agents[job.name].act()
      console.timeEnd(label)
    }, {
      concurrency: 1
    })
  }

  async down() {
    await this.worker?.close()
  }
}
