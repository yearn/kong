import { Worker } from 'bullmq'
import { mq } from 'lib'
import { Processor } from 'lib/processor'
import { StateExtractor } from './state'
import { RpcClients, rpcs } from '../../../rpcs'
import { LogsExtractor } from './logs'

export default class YearnVaultExtractor implements Processor {
  rpcs: RpcClients
  logsExtractor: LogsExtractor = new LogsExtractor()
  stateExtractor: StateExtractor = new StateExtractor()
  worker: Worker | undefined

  constructor() {
    this.rpcs = rpcs.next()
  }

  async up() {
    await this.logsExtractor.up()
    await this.stateExtractor.up()
    this.worker = mq.worker(mq.q.yearn.vault.extract, async job => {
      await this.do(job)
    })
  }

  async down() {
    await this.worker?.close()
    await this.stateExtractor.down()
    await this.logsExtractor.down()
  }

  private async do(job: any) {
    switch(job.name) {
      case mq.q.yearn.vault.extractJobs.logs:{
        await this.logsExtractor.extract(job)
        break

      } case mq.q.yearn.vault.extractJobs.state:{
        await this.stateExtractor.extract(job)
        break

      } default: {
        throw new Error(`unknown job name ${job.name}`)
      }
    }
  }
}
