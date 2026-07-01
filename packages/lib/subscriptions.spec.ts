import { strict as assert } from 'node:assert'
import { isPublicHttpsUrl } from './subscriptions'

describe('isPublicHttpsUrl', () => {
  it('accepts public https urls', () => {
    assert.equal(isPublicHttpsUrl('https://v2-estimated-apr-hook.vercel.app/webhook'), true)
    assert.equal(isPublicHttpsUrl('https://katana-apr.yearn.fi/api/webhook'), true)
  })

  it('rejects non-https schemes', () => {
    assert.equal(isPublicHttpsUrl('http://example.com/webhook'), false)
    assert.equal(isPublicHttpsUrl('file:///etc/passwd'), false)
  })

  it('rejects localhost and loopback hosts', () => {
    assert.equal(isPublicHttpsUrl('https://localhost/x'), false)
    assert.equal(isPublicHttpsUrl('https://api.localhost/x'), false)
    assert.equal(isPublicHttpsUrl('https://127.0.0.1/x'), false)
    assert.equal(isPublicHttpsUrl('https://[::1]/x'), false)
  })

  it('rejects private ranges and the cloud metadata ip', () => {
    assert.equal(isPublicHttpsUrl('https://10.0.0.5/x'), false)
    assert.equal(isPublicHttpsUrl('https://192.168.1.1/x'), false)
    assert.equal(isPublicHttpsUrl('https://172.16.0.1/x'), false)
    assert.equal(isPublicHttpsUrl('https://169.254.169.254/latest/meta-data'), false)
  })

  it('rejects internal tlds and malformed urls', () => {
    assert.equal(isPublicHttpsUrl('https://db.internal/x'), false)
    assert.equal(isPublicHttpsUrl('not a url'), false)
  })
})
