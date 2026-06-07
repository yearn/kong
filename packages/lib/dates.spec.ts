import { describe, expect, it } from 'vitest'
import { endOfDayMs, endOfStringDay, epoch, findMissingTimestamps, makeTimeline, startOfDayMs } from './dates'

describe('dates', function() {
  it('computes start of day', async function() {
    const start = new Date('2021-01-01T23:59:59.999Z')
    const end = startOfDayMs(start.getTime())
    expect(end).to.deep.eq((new Date('2021-01-01T00:00:00.000Z')).getTime())
  })

  it('computes end of day', async function() {
    const start = new Date('2021-01-01T00:00:00.000Z')
    const end = endOfDayMs(start.getTime())
    expect(end).to.deep.eq((new Date('2021-01-01T23:59:59.999Z')).getTime())
  })

  it('makes timelines', async function() {
    expect(makeTimeline(epoch('2024-01-01'), epoch('2024-01-01'))).to.deep.equal([
      endOfStringDay('2024-01-01')
    ])

    expect(makeTimeline(epoch('2024-01-01'), epoch('2024-01-05'))).to.deep.equal([
      endOfStringDay('2024-01-01'),
      endOfStringDay('2024-01-02'),
      endOfStringDay('2024-01-03'),
      endOfStringDay('2024-01-04'),
      endOfStringDay('2024-01-05')
    ])

    expect(makeTimeline(epoch('2024-01-05'), epoch('2024-01-01'))).to.deep.equal([])
  })

  it('finds missing dates', async function() {
    const start: bigint = endOfStringDay('2024-01-01')
    const end: bigint = endOfStringDay('2024-01-5')
    const outputed: bigint[] = [
      start,
      endOfStringDay('2024-01-3'),
      end
    ]

    expect(findMissingTimestamps(start, end, outputed)).to.deep.equal([
      endOfStringDay('2024-01-2'),
      endOfStringDay('2024-01-4')
    ])
  })

  it('finds no missing dates', async function() {
    const start: bigint = endOfStringDay('2024-01-01')
    const end: bigint = endOfStringDay('2024-01-5')
    const outputed: bigint[] = [
      start,
      endOfStringDay('2024-01-2'),
      endOfStringDay('2024-01-3'),
      endOfStringDay('2024-01-4'),
      end
    ]
    expect(findMissingTimestamps(start, end, outputed)).to.be.empty
  })
})
