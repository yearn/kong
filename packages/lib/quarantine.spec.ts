import { describe, expect, it, vi } from 'vitest'
import { Queue } from 'bullmq'
import { down, quarantine } from './mq'

describe('unknown-job quarantine', () => {
  it('uses a separate durable queue with a stable ID and original payload', async () => {
    const add = vi.spyOn(Queue.prototype, 'add').mockResolvedValue({} as never)
    try {
      const original = { queueName: 'extract-1', id: '42', name: 'new-job', data: { chainId: 1, value: 'payload' } }
      await quarantine(original)
      expect(add).toHaveBeenCalledWith('new-job', {
        queue: 'extract-1', id: '42', name: 'new-job', data: original.data
      }, expect.objectContaining({
        jobId: Buffer.from(JSON.stringify(['extract-1', '42'])).toString('base64url'),
        removeOnComplete: false, removeOnFail: false
      }))
      expect(add.mock.contexts[0]).toHaveProperty('name', 'quarantine')
    } finally {
      add.mockRestore()
      await down()
    }
  })
})
