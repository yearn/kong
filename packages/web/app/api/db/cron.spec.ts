import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import db from './index'
import { cronDb } from './cron'
import * as requestDb from './index'

describe('cron vs request pg pools', () => {
  it('does not export cronDb from the request-serving db module', () => {
    assert.equal('cronDb' in requestDb, false)
    assert.notEqual(db, cronDb)
  })

  it('defaults the cron pool to 40 connections and a 60s acquire timeout', () => {
    const src = readFileSync(new URL('./cron.ts', import.meta.url), 'utf8')
    assert.match(src, /POSTGRES_CRON_POOL_MAX \?\? '40'/)
    assert.match(src, /connectionTimeoutMillis: 60_000/)
  })

  it('defaults the request pool to 4 connections and a 5s acquire timeout', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    assert.match(src, /POSTGRES_POOL_MAX \?\? '4'/)
    assert.match(src, /connectionTimeoutMillis: 5_000/)
  })

  it('logs idle cron pool errors instead of crashing the process', () => {
    assert.equal(cronDb.listenerCount('error'), 1)
  })
})
