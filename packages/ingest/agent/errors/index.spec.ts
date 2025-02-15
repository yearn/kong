import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { ErrorsAgent, LOGS_REDIS_KEY } from '.'
import { Queue } from 'bullmq'
import { summarize } from './ai'

mock.module('bullmq', () => ({
  Queue: mock.fn(() => ({
    getJobs: mock.fn(),
    clean: mock.fn(),
    client: Promise.resolve({
      set: mock.fn()
    })
  }))
}))

mock.module('./ai', () => ({
  summarize: mock.fn()
}))

describe('ErrorsAgent', () => {
  let agent: ErrorsAgent

  beforeEach(() => {
    agent = new ErrorsAgent()
    mock.resetAll()
  })

  test('should handle no failed jobs', async () => {
    Queue.prototype.getJobs = mock.fn(() => Promise.resolve([]))

    await agent.act()

    expect(Queue.prototype.clean).toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
  })

  test('should process failed jobs and store summary', async () => {
    const mockFailedJobs = [
      { stacktrace: ['Error 1: Something went wrong'] },
      { stacktrace: ['Error 2: Another error occurred'] }
    ]

    Queue.prototype.getJobs = mock.fn(() => Promise.resolve(mockFailedJobs))

    const mockSummary = ['Summarized error 1', 'Summarized error 2'];
    (summarize as any).mockImplementation(() => Promise.resolve(mockSummary))

    await agent.act()

    expect(Queue.prototype.clean).toHaveBeenCalled()

    expect(summarize).toHaveBeenCalledWith([
      'Error 1: Something went wrong',
      'Error 2: Another error occurred'
    ])

    expect(agent.redis?.set).toHaveBeenCalledWith(
      LOGS_REDIS_KEY,
      JSON.stringify(mockSummary)
    )
  })

  test('should handle AI error gracefully', async () => {
    const mockFailedJobs = [
      { stacktrace: ['Error: Test error'] }
    ]

    Queue.prototype.getJobs = mock.fn(() => Promise.resolve(mockFailedJobs));

    (summarize as any).mockImplementation(() => Promise.resolve(null))

    await agent.act()

    expect(Queue.prototype.clean).toHaveBeenCalled()

    expect(summarize).toHaveBeenCalled()

    expect(agent.redis?.set).not.toHaveBeenCalled()
  })
})
