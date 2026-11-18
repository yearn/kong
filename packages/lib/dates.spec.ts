import { expect } from 'chai'
import { endOfDayMs, endOfStringDay, epoch, isClosedDay, makeTimeline, startOfDayMs } from './dates'

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

  it('treats today as open until the UTC day rolls over', async function() {
    const today = endOfStringDay('2021-01-01')
    expect(isClosedDay(today, epoch('2021-01-01T23:59:59Z'))).to.equal(false)
    expect(isClosedDay(today, epoch('2021-01-02T00:00:00Z'))).to.equal(true)
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
})
