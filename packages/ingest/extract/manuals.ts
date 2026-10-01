import { mq } from 'lib'
import manuals from 'lib/manuals'

export class ManualsExtractor {
  async extract() {
    await mq.addBulk(manuals.map(manual => ({ job: mq.job.load.thing, data: manual })))
  }
}
