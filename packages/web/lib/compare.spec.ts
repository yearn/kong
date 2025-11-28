import { strict as assert } from 'node:assert'
import { extractVersion } from './compare'

describe('extractVersion', () => {
  it('should extract version numbers correctly', () => {
    assert.equal(extractVersion('0.3.3.Edited'), '0.3.3')
    assert.equal(extractVersion('1.2.3'), '1.2.3')
    assert.equal(extractVersion('2.4'), '2.4')
    assert.equal(extractVersion('3'), '3')
    assert.equal(extractVersion('4.5.6.7.8'), '4.5.6')
    assert.equal(extractVersion('1.2.3-alpha'), '1.2.3')
    assert.equal(extractVersion('v2.3.4'), '2.3.4')
  })

  it('should return "0" for invalid versions', () => {
    assert.equal(extractVersion('Invalid'), '0')
    assert.equal(extractVersion(''), '0')
    assert.equal(extractVersion('a.b.c'), '0')
  })
})
