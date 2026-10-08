// Run from the repository root so dotenv loads its .env before MQ initializes.
import 'dotenv/config'
import * as mq from 'lib/mq'
import { archiveQuarantine, createQuarantineArchive, writeQuarantineRecord } from 'lib/quarantine'

const destination = process.argv[2]
if (!destination) throw new Error('Usage: bun packages/scripts/src/archive-quarantine.ts <new-archive.jsonl>')
const file = await createQuarantineArchive(destination)
const queue = mq.connect(mq.q.quarantine)
try {
  const count = await archiveQuarantine(queue, record => writeQuarantineRecord(file, record))
  console.log(`Archived and removed ${count} quarantine jobs to ${destination}`)
} finally {
  await file.close()
  await queue.close()
}
