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
let deduplicated = 0
let lineNumber = 0
try {
  for await (const line of lines) {
    lineNumber++
    if (!line.trim()) continue
    await replayQuarantine(JSON.parse(line), async (name, jobName, data, jobId) => {
      if (!queues.has(name)) queues.set(name, mq.connect(name))
      const queue = queues.get(name)!
      if (await queue.getJob(jobId)) { deduplicated++; return }
      const added = await queue.add(jobName, data, { jobId, priority: mq.DEFAULT_PRIORITY, attempts: 1 })
      count++
      return added
    })
  }
  console.log(`Re-enqueued ${count} archived quarantine records, ${deduplicated} already present`)
} catch (error) {
  console.error(`Replay aborted at line ${lineNumber}; ${count} records re-enqueued, ${deduplicated} already present, from ${archive}`)
  throw error
} finally {
  lines.close()
  await Promise.all([...queues.values()].map(queue => queue.close()))
}
