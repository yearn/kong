import { describe, expect, it, vi } from 'vitest'
import { toEventSelector } from 'viem'

const { mqAdd, travelled } = vi.hoisted(() => ({
  mqAdd: vi.fn(async () => undefined),
  travelled: {} as Record<string, { from: bigint, to: bigint }[]>
}))

vi.mock('lib', async () => ({
  mq: { add: mqAdd, job: { extract: { evmlog: { queue: 'extract', name: 'evmlog', bychain: true } } } },
  strider: await vi.importActual('lib/strider')
}))

vi.mock('lib/blocks', () => ({
  estimateHeight: vi.fn(),
  getBlockNumber: vi.fn(async () => 999n)
}))

vi.mock('../db', () => ({
  adoptLegacyStrides: vi.fn(async () => undefined),
  getTravelledStrides: vi.fn(async () => travelled)
}))

import EventsFanout from './events'
import { adoptLegacyStrides, getTravelledStrides } from '../db'
import abiutil from '../abiutil'

const CHAIN_ID = 1
const ADDRESS = '0x0eD92e4225126578791303BF579F2853e7Fdca6B' as const
const source = { chainId: CHAIN_ID, address: ADDRESS, inceptBlock: 0n }

async function selectors(abiPath: string) {
  return abiutil.events(await abiutil.load(abiPath)).map((e: object) => toEventSelector(e as never))
}

describe('EventsFanout', () => {
  it('fetches yearn-only events over blocks another reader already covered', async () => {
    const erc4626 = await selectors('erc4626')
    for (const signature of erc4626) travelled[signature] = [{ from: 0n, to: 999n }]

    await new EventsFanout().fanout({ readers: [
      { abi: { abiPath: 'erc4626' }, source },
      { abi: { abiPath: 'yearn/3/vault' }, source }
    ] as never })

    expect(mqAdd).toHaveBeenCalledTimes(1)
    const job = (mqAdd.mock.calls[0] as unknown[])[1] as { signatures: string[], abiPaths: string[], from: bigint, to: bigint }
    const strategyChanged = toEventSelector('event StrategyChanged(address indexed strategy, uint256 indexed change_type)')

    expect(job.abiPaths).toEqual(['erc4626', 'yearn/3/vault'])
    expect(job.from).toBe(0n)
    expect(job.to).toBe(999n)
    expect(job.signatures).toContain(strategyChanged)
    for (const signature of erc4626) expect(job.signatures).not.toContain(signature)
    expect(adoptLegacyStrides).toHaveBeenCalledWith(CHAIN_ID, ADDRESS, expect.any(Array), true)
  })
  it('normalizes legacy source payloads before adopting and reading coverage', async () => {
    await new EventsFanout().fanout({ abi: { abiPath: 'erc4626' }, source: { ...source, address: ADDRESS.toLowerCase() } } as never)
    expect(adoptLegacyStrides).toHaveBeenLastCalledWith(CHAIN_ID, ADDRESS, expect.any(Array), false)
    expect(getTravelledStrides).toHaveBeenLastCalledWith(CHAIN_ID, ADDRESS, expect.any(Array))
  })
})
