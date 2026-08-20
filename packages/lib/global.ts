if (!Object.getOwnPropertyDescriptor(BigInt.prototype, 'toJSON')) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    get() {
      'use strict'
      return () => String(this)
    }
  })
}
