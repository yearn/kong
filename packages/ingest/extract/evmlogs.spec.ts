import { describe, expect, it } from 'vitest'
import { extractLogArgs } from './evmlogs'

describe('extract/evmlogs', function() {
  it('converts log args', async function() {
    expect(extractLogArgs({})).to.deep.equal({})
    expect(extractLogArgs({ args: {} })).to.deep.equal({})
    expect(extractLogArgs({ args: { mushi: 'nihao' } })).to.deep.equal({ mushi: 'nihao' })
    expect(extractLogArgs({ args: [] })).to.deep.equal({})
    expect(extractLogArgs({ args: ['hola'] })).to.deep.equal({ arg0: 'hola' })
  })
})
