import { strict as assert } from 'node:assert'
import db from './index'
import { cronDb } from './cron'
import * as requestDb from './index'

describe('cron vs request pg pools', () => {
  it('does not export cronDb from the request-serving db module', () => {
    assert.equal('cronDb' in requestDb, false)
    assert.notEqual(db, cronDb)
  })

  it('defaults the cron pool to 40 connections and a 60s acquire timeout', () => {
    assert.equal(cronDb.options.max, 40)
    assert.equal(cronDb.options.connectionTimeoutMillis, 60_000)
  })

  it('defaults the request pool to 4 connections and a 5s acquire timeout', () => {
    assert.equal(db.options.max, 4)
    assert.equal(db.options.connectionTimeoutMillis, 5_000)
  })

  it('logs idle cron pool errors instead of crashing the process', () => {
    assert.equal(cronDb.listenerCount('error'), 1)
  })
})
