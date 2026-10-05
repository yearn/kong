// Run from the repository root so dotenv loads its .env before MQ initializes.
import 'dotenv/config'
import { open } from 'node:fs/promises'
import * as mq from 'lib/mq'
import { archiveQuarantine } from 'lib/quarantine'

const destination = process.argv[2]
if (!destination) throw new Error('Usage: bun packages/scripts/src/archive-quarantine.ts <new-archive.jsonl>')
// Exclusive creation prevents accidentally overwriting a previous recovery archive.
const file = await open(destination, 'wx', 0o600)
const queue = mq.connect(mq.q.quarantine)
try {
  const count = await archiveQuarantine(queue, async record => {
    await file.writeFile(JSON.stringify(record) + '\n')
    await file.sync()
  })
  console.log(`Archived and removed ${count} quarantine jobs to ${destination}`)
} finally {
  await file.close()
  await queue.close()
}
