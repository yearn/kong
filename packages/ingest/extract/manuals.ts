import { mq } from 'lib'
import manuals from 'lib/manuals'

export class ManualsExtractor {
  async extract() {
    await mq.addBulk((function* () {
      for (const manual of manuals) yield { job: mq.job.load.thing, data: manual }
    })())
  }
}
