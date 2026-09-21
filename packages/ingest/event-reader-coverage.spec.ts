import { Queue } from 'bullmq'
import { expect } from 'chai'
import { toEventSelector } from 'viem'
import { afterEach, describe, it, vi } from 'vitest'
import { mq } from 'lib'
import { AbiConfigSchema, SourceConfigSchema } from 'lib/abis'
import * as blocks from 'lib/blocks'
import db, { getTravelledStrides } from './db'
import { EvmLogsExtractor } from './extract/evmlogs'
import EventsFanout from './fanout/events'
import { upsertEvmLog } from './load'
import { rpcs } from './rpcs'

const CHAIN_ID = 994473
const ADDRESS = '0x1111111111111111111111111111111111111111' as const
const STRATEGY = '0x2222222222222222222222222222222222222222' as const
const TRANSACTION_HASH = `0x${'ab'.repeat(32)}` as const
const EVENT_SIGNATURE = `0x${'cd'.repeat(32)}` as const
const GENERIC_READER = 'erc4626'
const YEARN_READER = 'yearn/3/vault'

const source = SourceConfigSchema.parse({
  chainId: CHAIN_ID,
  address: ADDRESS,
  inceptBlock: 1n,
  startBlock: 1n,
  endBlock: 10n
})

function eventLog(hook: Record<string, unknown> = {}) {
  return {
    chainId: CHAIN_ID,
    address: ADDRESS,
    eventName: 'StrategyChanged',
    signature: EVENT_SIGNATURE,
    topics: [EVENT_SIGNATURE],
    args: { strategy: STRATEGY },
    hook,
    blockNumber: 5n,
    blockTime: 1_000n,
    logIndex: 0,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 0
  }
}

async function loadRange(abiPath: string, from: bigint, to: bigint, options: { replay?: boolean, batch?: object[] } = {}) {
  await upsertEvmLog({
    abiPath,
    chainId: CHAIN_ID,
    address: ADDRESS,
    from,
    to,
    replay: options.replay,
    batch: options.batch ?? []
  })
}

async function fanout(abiPath: string, replay?: { enabled: boolean }) {
  await new EventsFanout().fanout({ abi: AbiConfigSchema.parse({ abiPath }), source, replay })
}

async function clearFixtures() {
  await db.query('DELETE FROM evmlog WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
  await db.query('DELETE FROM evmlog_strides WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
  await db.query('DELETE FROM thing WHERE chain_id = $1 AND address IN ($2, $3)', [CHAIN_ID, ADDRESS, STRATEGY])
}

afterEach(async () => {
  vi.restoreAllMocks()
  await clearFixtures()
})

describe('reader-specific event coverage', () => {
  it('keeps Yearn planning after generic coverage and skips only after Yearn finishes', async () => {
    await loadRange(GENERIC_READER, 1n, 10n)

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, GENERIC_READER)).to.deep.equal([{ from: 1n, to: 10n }])
    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, YEARN_READER)).to.equal(undefined)

    const add = vi.spyOn(mq, 'add').mockResolvedValue(undefined as never)
    await fanout(YEARN_READER)
    expect(add.mock.calls).to.have.lengthOf(1)
    expect(add.mock.calls[0]?.[1]).to.include({ abiPath: YEARN_READER, chainId: CHAIN_ID, address: ADDRESS })

    await loadRange(YEARN_READER, 1n, 10n)
    add.mockClear()
    await fanout(YEARN_READER)
    expect(add.mock.calls).to.have.lengthOf(0)
  })

  it('skips a repeated range for the same reader', async () => {
    await loadRange(GENERIC_READER, 1n, 10n)

    const add = vi.spyOn(mq, 'add').mockResolvedValue(undefined as never)
    await fanout(GENERIC_READER)

    expect(add.mock.calls).to.have.lengthOf(0)
  })

  it('retains both ranges when the same reader writes its first coverage concurrently', async () => {
    await Promise.all([
      loadRange(GENERIC_READER, 1n, 10n),
      loadRange(GENERIC_READER, 20n, 30n)
    ])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, GENERIC_READER)).to.deep.equal([
      { from: 1n, to: 10n },
      { from: 20n, to: 30n }
    ])
  })

  it('scopes empty successful batches to their reader', async () => {
    await Promise.all([
      loadRange(GENERIC_READER, 1n, 10n),
      loadRange(YEARN_READER, 20n, 30n)
    ])

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, GENERIC_READER)).to.deep.equal([{ from: 1n, to: 10n }])
    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, YEARN_READER)).to.deep.equal([{ from: 20n, to: 30n }])
    const result = await db.query('SELECT COUNT(*)::int AS count FROM evmlog WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
    expect(result.rows[0].count).to.equal(0)
  })

  it('does not publish coverage when the event transaction fails', async () => {
    await db.query(`
      CREATE OR REPLACE FUNCTION event_reader_force_coverage_failure()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'forced coverage failure'; END; $$
    `)
    await db.query(`
      CREATE TRIGGER event_reader_force_coverage_failure
      BEFORE UPDATE ON evmlog_strides
      FOR EACH ROW EXECUTE FUNCTION event_reader_force_coverage_failure()
    `)

    let failed = false
    try {
      await loadRange(GENERIC_READER, 1n, 10n, { batch: [eventLog()] })
    } catch {
      failed = true
    } finally {
      await db.query('DROP TRIGGER event_reader_force_coverage_failure ON evmlog_strides')
      await db.query('DROP FUNCTION event_reader_force_coverage_failure()')
    }

    expect(failed).to.equal(true)
    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, GENERIC_READER)).to.equal(undefined)
    const result = await db.query('SELECT COUNT(*)::int AS count FROM evmlog WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
    expect(result.rows[0].count).to.equal(0)
  })

  it('writes replay events without establishing RPC coverage', async () => {
    await loadRange(YEARN_READER, 1n, 10n, { replay: true, batch: [eventLog()] })

    expect(await getTravelledStrides(CHAIN_ID, ADDRESS, YEARN_READER)).to.equal(undefined)
    const result = await db.query('SELECT COUNT(*)::int AS count FROM evmlog WHERE chain_id = $1 AND address = $2', [CHAIN_ID, ADDRESS])
    expect(result.rows[0].count).to.equal(1)
  })

  it('keeps one raw event row and merges hook enrichment across readers', async () => {
    await loadRange(GENERIC_READER, 1n, 10n, { batch: [eventLog({ generic: true })] })
    await loadRange(YEARN_READER, 1n, 10n, { batch: [eventLog({ yearn: true })] })
    await loadRange(GENERIC_READER, 1n, 10n, { batch: [eventLog()] })

    const result = await db.query(
      'SELECT hook FROM evmlog WHERE chain_id = $1 AND address = $2',
      [CHAIN_ID, ADDRESS]
    )
    expect(result.rows).to.have.lengthOf(1)
    expect(result.rows[0].hook).to.deep.equal({ generic: true, yearn: true })
  })

  it('uses separate BullMQ IDs for readers while retaining same-reader deduplication', async () => {
    const queue = new Queue(`extract-${CHAIN_ID}`, {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379)
      }
    })

    try {
      await queue.obliterate({ force: true })
      await fanout(GENERIC_READER)
      await fanout(YEARN_READER)
      await fanout(GENERIC_READER)

      const genericId = `evmlog-${GENERIC_READER}-${CHAIN_ID}-${ADDRESS}-1-10`
      const yearnId = `evmlog-${YEARN_READER}-${CHAIN_ID}-${ADDRESS}-1-10`
      const genericJob = await queue.getJob(genericId)
      const yearnJob = await queue.getJob(yearnId)
      expect(genericJob?.name).to.equal('evmlog')
      expect(yearnJob?.name).to.equal('evmlog')
      expect(genericJob?.data.abiPath).to.equal(GENERIC_READER)
      expect(yearnJob?.data.abiPath).to.equal(YEARN_READER)

      const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed', 'active'])
      expect(jobs.filter(job => job.id === genericId)).to.have.lengthOf(1)
      expect(jobs.filter(job => job.id === yearnId)).to.have.lengthOf(1)
    } finally {
      await queue.obliterate({ force: true })
      await queue.close()
    }
  })
})

describe('Yearn event extraction after another reader completes', () => {
  it('requests StrategyChanged in the Yearn RPC event filter', async () => {
    await loadRange(GENERIC_READER, 1n, 10n)
    await db.query(
      'INSERT INTO thing (chain_id, address, label, defaults) VALUES ($1, $2, $3, $4)',
      [CHAIN_ID, ADDRESS, 'vault', JSON.stringify({ decimals: 18 })]
    )

    const strategyChanged = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
    const getLogs = vi.fn(async (params: { address: string, events: unknown[], fromBlock: bigint, toBlock: bigint }) => {
      void params
      return [{
        address: ADDRESS,
        eventName: 'StrategyChanged',
        topics: [strategyChanged],
        args: { strategy: STRATEGY, changeType: 0n },
        blockNumber: 5n,
        logIndex: 0,
        transactionHash: TRANSACTION_HASH,
        transactionIndex: 0
      }]
    })
    const next = vi.spyOn(rpcs, 'next').mockReturnValue({ getLogs } as never)
    const defaultStart = vi.spyOn(blocks, 'getDefaultStartBlockNumber').mockResolvedValue(0n)
    const blockTime = vi.spyOn(blocks, 'getBlockTime').mockResolvedValue(1_000n)
    const add = vi.spyOn(mq, 'add').mockResolvedValue(undefined as never)
    const extractor = new EvmLogsExtractor()
    extractor.resolveHooks = () => [{
      type: 'event',
      abiPath: YEARN_READER,
      module: {
        topics: [strategyChanged],
        default: vi.fn(async () => ({ yearn: true }))
      }
    }]

    await extractor.extract({
      abiPath: YEARN_READER,
      chainId: CHAIN_ID,
      address: ADDRESS,
      from: 1n,
      to: 10n
    })

    expect(next.mock.calls[0]).to.deep.equal([CHAIN_ID, 1n])
    expect(defaultStart.mock.calls[0]).to.deep.equal([CHAIN_ID])
    expect(blockTime.mock.calls[0]).to.deep.equal([CHAIN_ID, 5n])
    expect(getLogs.mock.calls).to.have.lengthOf(1)
    const params = getLogs.mock.calls[0]?.[0]
    expect(params).to.not.equal(undefined)
    expect(params?.events.some(event => (event as { name?: string }).name === 'StrategyChanged')).to.equal(true)
    expect(add.mock.calls[0]?.[1]).to.include({ abiPath: YEARN_READER, replay: undefined })
  })
})
