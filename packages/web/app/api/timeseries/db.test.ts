import assert from 'assert'
import * as viem from 'viem'
import db from '../db'
import { getFullTimeseries, getLatestTimeseries, getVaults } from './db'

type QueryCall = {
  sql: string | TemplateStringsArray
  params?: unknown[]
}

describe('timeseries db helpers', function() {
  const originalQuery = db.query.bind(db)
  let calls: QueryCall[] = []

  beforeEach(function() {
    calls = []
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override for tests
    db.query = async (sql: string | TemplateStringsArray, params?: unknown[]) => {
      calls.push({ sql, params })
      return { rows: [] }
    }
  })

  afterEach(function() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore restore original
    db.query = originalQuery
  })

  it('getVaults queries distinct vaults ordered by chain and address', async function() {
    const rows = [
      { chainId: 1, address: '0xabc' },
      { chainId: 10, address: '0xdef' },
    ]

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override for this test
    db.query = async (sql: string | TemplateStringsArray, params?: unknown[]) => {
      calls.push({ sql, params })
      return { rows }
    }

    const result = await getVaults()
    assert.deepStrictEqual(result, rows)

    assert.strictEqual(calls.length, 1)
    const call = calls[0]
    const sql = call.sql.toString()
    assert(sql.includes('FROM thing'))
    assert(sql.includes('WHERE label = \'vault\''))
    assert(sql.includes('ORDER BY chain_id, address'))
    assert(!call.params || call.params.length === 0)
  })

  it('getFullTimeseries normalizes address, hardcodes period, and orders ASC', async function() {
    const rows = [
      {
        chainId: 1,
        address: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
        label: 'pps',
        component: 'humanized',
        value: 1.23,
        period: '1 day',
        time: 1700000000n,
      },
    ]

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override for this test
    db.query = async (sql: string | TemplateStringsArray, params?: unknown[]) => {
      calls.push({ sql, params })
      return { rows }
    }

    const addressInput = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const result = await getFullTimeseries(1, addressInput, 'pps')

    assert.deepStrictEqual(result, rows)
    assert.strictEqual(calls.length, 1)
    const call = calls[0]
    const sql = call.sql.toString()
    assert(sql.includes('time_bucket(\'1 day\''))
    assert(sql.includes('ORDER BY time ASC'))
    assert.deepStrictEqual(call.params, [
      1,
      viem.getAddress(addressInput),
      'pps',
    ])
  })

  it('getLatestTimeseries normalizes address and selects latest per component', async function() {
    const rows = [
      {
        chainId: 1,
        address: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
        label: 'tvl-c',
        component: 'tvl',
        value: 123,
        period: undefined,
        time: 1700000000n,
      },
    ]

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore override for this test
    db.query = async (sql: string | TemplateStringsArray, params?: unknown[]) => {
      calls.push({ sql, params })
      return { rows }
    }

    const addressInput = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const result = await getLatestTimeseries(1, addressInput, 'tvl-c')

    assert.deepStrictEqual(result, rows)
    assert.strictEqual(calls.length, 1)

    const call = calls[0]
    const sql = call.sql.toString()
    assert(sql.includes('SELECT DISTINCT ON (component)'))
    assert(sql.includes('ORDER BY component, series_time DESC'))
    assert.deepStrictEqual(call.params, [
      1,
      viem.getAddress(addressInput),
      'tvl-c',
    ])
  })
})
