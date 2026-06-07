import { describe, expect, it } from 'vitest'
import { clean } from './version'

describe('version', function() {
  it('cleans version strings', async function() {
    expect(clean('v1.0.0')).to.equal('1.0.0')
    expect(clean('2.0.0')).to.equal('2.0.0')
    expect(clean('0.3.3.Edited')).to.equal('0.3.3')
  })
})
