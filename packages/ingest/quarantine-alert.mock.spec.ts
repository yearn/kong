import { describe, expect, it, vi } from 'vitest'
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('lib', () => ({ sentry: { captureMessage }, mq: {} }))
import { reportQuarantineDepth } from './retired-jobs'

describe('quarantine capacity alert', () => {
  it('alerts on the first nonzero backlog and resets after draining', () => {
    reportQuarantineDepth(0)
    reportQuarantineDepth(1)
    reportQuarantineDepth(100)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('QUARANTINE_BACKLOG', expect.objectContaining({ level: 'error', extra: { depth: 1 } }))
    reportQuarantineDepth(0)
    reportQuarantineDepth(1)
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })
})
