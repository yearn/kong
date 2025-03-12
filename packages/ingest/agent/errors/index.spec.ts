import { describe, it, beforeEach, afterEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { Queue } from 'bullmq'
import { ErrorsAgent, LOGS_REDIS_KEY } from './index'
import * as ai from './ai'
import { q, bull } from 'lib/mq'
import { cache } from 'lib'

describe('ErrorsAgent', () => {
  let agent: ErrorsAgent
  let summarizeStub: sinon.SinonStub
  let queues: Queue[] = []
  let redisClient: any

  before(async () => {
    await cache.up()
  })

  after(async () => {
    for (const queue of queues) {
      await queue.clean(0, 0, 'failed')
      await queue.close()
    }
    queues = []
  })

  beforeEach(async () => {
    agent = new ErrorsAgent()
    summarizeStub = sinon.stub(ai, 'summarize')

    for (const queueName of Object.keys(q)) {
      const queue = new Queue(queueName, { connection: bull.connection })
      queues.push(queue)

      if (!redisClient) {
        redisClient = await queue.client
      }

      await queue.clean(0, 0, 'failed')
    }

    if (redisClient) {
      await redisClient.del(LOGS_REDIS_KEY)
    }
  })

  afterEach(async () => {
    sinon.restore()

    for (const queue of queues) {
      await queue.clean(0, 0, 'failed')
    }

    if (redisClient) {
      await redisClient.del(LOGS_REDIS_KEY)
    }
  })

  it('should handle no failed jobs', async () => {
    await agent.act()
    expect(summarizeStub.called).to.be.false
  })

  it('should process failed jobs and store summary in Redis', async () => {
    const testQueue = queues[0]
    const timestamp = Date.now()
    const stacktrace = ['Error 1 stack trace']
    const jobId = `test-job-${timestamp}`

    await redisClient.hset(
      `bull:${testQueue.name}:${jobId}`,
      'name', 'test-job',
      'data', JSON.stringify({ test: 'data' }),
      'stacktrace', JSON.stringify(stacktrace),
      'failedReason', 'Test failure'
    )

    await redisClient.zadd(`bull:${testQueue.name}:failed`, timestamp, jobId)

    const mockSummary = ['Summarized error']
    summarizeStub.resolves(mockSummary)

    await agent.act()

    expect(summarizeStub.called).to.be.true

    const storedValue = await redisClient.get(LOGS_REDIS_KEY)
    expect(storedValue).to.equal(JSON.stringify(mockSummary))

    const failedJobs = await testQueue.getJobs('failed', 0, 0, true)
    expect(failedJobs.length).to.equal(0)
  })

  it('should handle AI summarization failure', async () => {
    const testQueue = queues[0]
    const timestamp = Date.now()
    const stacktrace = ['Error stack trace']
    const jobId = `test-job-${timestamp + 1}`

    await redisClient.hset(
      `bull:${testQueue.name}:${jobId}`,
      'name', 'test-job',
      'data', JSON.stringify({ test: 'data' }),
      'stacktrace', JSON.stringify(stacktrace),
      'failedReason', 'Test failure'
    )

    await redisClient.zadd(`bull:${testQueue.name}:failed`, timestamp, jobId)

    summarizeStub.resolves(null)

    await agent.act()

    expect(summarizeStub.called).to.be.true

    const storedValue = await redisClient.get(LOGS_REDIS_KEY)
    expect(storedValue).to.be.null
  })

  it('should process failed jobs from multiple queues', async () => {
    const queueStacktraces: { [queueName: string]: string } = {}
    const createdJobs: { queue: string, id: string }[] = []
    const baseTimestamp = Date.now()

    for (let i = 0; i < queues.length; i++) {
      const queue = queues[i]
      const queueName = queue.name
      const stacktrace = [`Error in ${queueName} queue`]
      queueStacktraces[queueName] = stacktrace[0]

      const timestamp = baseTimestamp + i
      const jobId = `test-job-multi-${timestamp}`
      createdJobs.push({ queue: queueName, id: jobId })

      await redisClient.hset(
        `bull:${queueName}:${jobId}`,
        'name', 'test-job',
        'data', JSON.stringify({ test: `data-${i}` }),
        'opts', JSON.stringify({}),
        'timestamp', timestamp,
        'stacktrace', JSON.stringify(stacktrace),
        'failedReason', `Test failure in queue ${queueName}`
      )

      await redisClient.zadd(`bull:${queueName}:failed`, timestamp, jobId)
    }

    const mockSummary = ['Summarized errors from multiple queues']
    summarizeStub.resolves(mockSummary)

    for (const queue of queues) {
      const jobsBefore = await queue.getJobs('failed', 0, 0, true)
      console.log(`Queue ${queue.name} has ${jobsBefore.length} failed jobs before test`)
    }

    await agent.act()

    for (const queue of queues) {
      const jobsAfter = await queue.getJobs('failed', 0, 0, true)
      console.log(`Queue ${queue.name} has ${jobsAfter.length} failed jobs after test`)
    }

    expect(summarizeStub.called).to.be.true

    const stacktraces = summarizeStub.firstCall.args[0]

    for (const queueName in queueStacktraces) {
      expect(stacktraces).to.include(queueStacktraces[queueName])
    }

    const storedValue = await redisClient.get(LOGS_REDIS_KEY)
    expect(storedValue).to.equal(JSON.stringify(mockSummary))

    for (const job of createdJobs) {
      await redisClient.zrem(`bull:${job.queue}:failed`, job.id)
      await redisClient.del(`bull:${job.queue}:${job.id}`)
    }

    for (const queue of queues) {
      const remainingFailedJobs = await queue.getJobs('failed', 0, 0, true)
      expect(remainingFailedJobs.length).to.equal(0)
    }
  })
})
