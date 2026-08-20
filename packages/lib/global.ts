Object.defineProperty(BigInt.prototype, 'toJSON', {
  configurable: true,
  get() {
    'use strict'
    return () => String(this)
  }
})
