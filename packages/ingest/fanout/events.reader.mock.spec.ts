import { describe, expect, it, vi } from 'vitest'
import { AbiConfig, SourceConfig } from 'lib/abis'

type AddCall = (
  job: unknown,
  data: Record<string, unknown>,
  options?: { jobId?: string }
) => Promise<void>

const { getTravelledStrides, mqAdd } = vi.hoisted(() => ({
  getTravelledStrides: vi.fn(async () => undefined),
  mqAdd: vi.fn<AddCall>(async () => undefined)
}))

vi.mock('../db', () => ({ getTravelledStrides }))

vi.mock('lib', () => ({
  mq: {
    add: mqAdd,
    job: { extract: { evmlog: { queue: 'extract', name: 'evmlog', bychain: true } } }
  },
  strider: {
    plan: (from: bigint, to: bigint) => [{ from, to }]
  }
}))

vi.mock('lib/blocks', () => ({
  estimateHeight: vi.fn(async (since: bigint) => since),
  getBlockNumber: vi.fn(async () => 100n)
}))

import EventsFanout from './events'

const SOURCE: SourceConfig = {
  chainId: 1,
  address: '0x1111111111111111111111111111111111111111' as const,
  inceptBlock: 1n,
  startBlock: 10n,
  endBlock: 20n,
  skip: false,
  only: false
}

async function fanout(abiPath: string, replay?: { enabled: boolean }) {
  await new EventsFanout().fanout({
    abi: { abiPath, sources: [], skip: false, only: false } satisfies AbiConfig,
    source: SOURCE,
    replay
  })
  return mqAdd.mock.calls.at(-1)?.[2]?.jobId
}

describe('fanout/events reader identity', () => {
  it('rejects an empty reader identity before scheduling', async () => {
    mqAdd.mockClear()
    let failed = false
    try {
      await fanout('')
    } catch (error) {
      failed = true
      expect((error as Error).name).to.equal('ZodError')
    }
    expect(failed).to.equal(true)
    expect(mqAdd).not.toHaveBeenCalled()
  })

  it('uses distinct IDs for readers and a stable ID for repeated normal work', async () => {
    mqAdd.mockClear()
    getTravelledStrides.mockClear()

    const yearnId = await fanout('yearn/3/vault')
    const repeatedYearnId = await fanout('yearn/3/vault')
    const erc4626Id = await fanout('erc4626')

    expect(yearnId).to.equal('evmlog-yearn/3/vault-1-0x1111111111111111111111111111111111111111-10-20')
    expect(repeatedYearnId).to.equal(yearnId)
    expect(erc4626Id).to.not.equal(yearnId)
    expect(getTravelledStrides).toHaveBeenCalledWith(1, SOURCE.address, 'yearn/3/vault')
  })

  it('gives replay work a separate ID and skips the normal coverage lookup', async () => {
    mqAdd.mockClear()
    getTravelledStrides.mockClear()

    const normalId = await fanout('yearn/3/vault')
    const replayId = await fanout('yearn/3/vault', { enabled: true })

    expect(replayId).to.match(new RegExp(`^${normalId}-replay-\\d+$`))
    expect(getTravelledStrides).toHaveBeenCalledTimes(1)
  })
})
