// Run from the repository root so dotenv loads its .env before MQ initializes.
import 'dotenv/config'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import * as mq from 'lib/mq'
import { replayQuarantine } from 'lib/quarantine'

const archive = process.argv[2]
if (!archive) throw new Error('Usage: bun packages/scripts/src/replay-quarantine.ts <archive.jsonl>')
const queues = new Map<string, ReturnType<typeof mq.connect>>()
const lines = createInterface({ input: createReadStream(archive), crlfDelay: Infinity })
let count = 0
try {
  for await (const line of lines) {
    if (!line.trim()) continue
    await replayQuarantine(JSON.parse(line), async (name, jobName, data, jobId) => {
      if (!queues.has(name)) queues.set(name, mq.connect(name))
      return queues.get(name)!.add(jobName, data, { jobId, priority: 100, attempts: 1 })
    })
    count++
  }
  console.log(`Re-enqueued ${count} archived quarantine records`)
} finally {
  lines.close()
  await Promise.all([...queues.values()].map(queue => queue.close()))
}
