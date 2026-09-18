import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeEventTopics, parseAbi, toEventSelector, type Address } from 'viem'
import { mq } from 'lib'
import * as blocks from 'lib/blocks'
import { rpcs } from 'lib/rpcs'
import abiutil from '../../../../../abiutil'
import db from '../../../../../db'
import { SnapshotExtractor } from '../../../../../extract/snapshot'
import { upsertSnapshot } from '../../../../../load'
import * as prices from '../../../../../prices'
import process from './hook'

const chainId = 1
const vault = '0x1000000000000000000000000000000000000476' as Address
const asset = '0x2000000000000000000000000000000000000476' as Address
const strategy = '0x3000000000000000000000000000000000000476' as Address
const manager = '0x4000000000000000000000000000000000000476' as Address
const assigned = '0x5000000000000000000000000000000000000476' as Address
const forged = '0x6000000000000000000000000000000000000476' as Address
const unrelatedEmitter = '0x7000000000000000000000000000000000000476' as Address
const factory = '0xfCF8c7C43dedd567083B422d6770F23B78D15BDe' as Address
const event = 'event NewDebtAllocator(address indexed allocator, address indexed vault)'
const signature = toEventSelector(event)

async function addDeployment(emitter: Address, allocator: Address, block: number) {
  await db.query(`INSERT INTO evmlog
    (chain_id,address,event_name,signature,topics,args,block_number,log_index,transaction_hash,transaction_index)
    VALUES ($1,$2,'NewDebtAllocator',$3,$4,$5,$6,0,$7,0)`,
  [chainId, emitter, signature, encodeEventTopics({ abi: parseAbi([event]), eventName: 'NewDebtAllocator', args: { allocator, vault } }),
    { allocator, vault }, block, `0x${block.toString(16).padStart(64, '0')}`])
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await db.query('DELETE FROM evmlog WHERE chain_id=$1 AND signature=$2 AND args->>\'vault\'=$3', [chainId, signature, vault])
  await db.query('DELETE FROM snapshot WHERE chain_id=$1 AND address=$2', [chainId, vault])
  await db.query('DELETE FROM thing WHERE chain_id=$1 AND address=ANY($2::text[])', [chainId, [asset, unrelatedEmitter]])
})

describe('issue #476: allocator event emitter spoofing', () => {
  it('ignores a newer forged deployment throughout extraction, ratio reads and persistence', async () => {
    await db.query('INSERT INTO thing (chain_id,address,label,defaults) VALUES ($1,$2,\'erc20\',$3),($1,$4,\'debtAllocator\',\'{}\')',
      [chainId, asset, { name: 'Fixture USD', symbol: 'USD', decimals: 18 }, unrelatedEmitter])
    await db.query('INSERT INTO snapshot (chain_id,address,snapshot,hook,block_number) VALUES ($1,$2,$3,\'{}\',1)',
      [chainId, vault, { asset, decimals: 18 }])
    await addDeployment(factory, assigned, 900)

    const abi = parseAbi([
      'function role_manager() view returns (address)', 'function asset() view returns (address)',
      'function decimals() view returns (uint8)', 'function apiVersion() view returns (string)',
      'function get_default_queue() view returns (address[])'
    ])
    const values: Record<string, unknown> = { role_manager: manager, asset, decimals: 18, apiVersion: '3.0.4', get_default_queue: [strategy] }
    const targets: string[] = []
    const readContract = vi.fn(async ({ address, functionName }: { address: Address; functionName: string; args?: unknown[]; blockNumber?: bigint }) => {
      targets.push(address)
      if (address === vault && functionName === 'performanceFee') return 0
      if (address === manager && functionName === 'getDebtAllocator') return assigned
      throw new Error(`Unexpected RPC target: ${address} ${functionName}`)
    })
    const multicall = vi.fn(async ({ contracts }: { contracts: { address: Address; functionName: string }[] }) => contracts.map(call => {
      targets.push(call.address)
      if (call.address === vault && call.functionName in values) return { status: 'success', result: values[call.functionName] }
      if (call.address === vault && call.functionName === 'strategies') return { status: 'success', result: [1n, 2n, 3n, 4n] }
      if (call.address === strategy && call.functionName === 'performanceFee') return { status: 'success', result: 100n }
      if (call.address === assigned && call.functionName === 'getStrategyTargetRatio') return { status: 'success', result: 250n }
      if (call.address === assigned && call.functionName === 'getStrategyMaxRatio') return { status: 'success', result: 500n }
      throw new Error(`Unexpected RPC target: ${call.address} ${call.functionName}`)
    }))
    vi.spyOn(rpcs, 'next').mockReturnValue({ readContract, multicall } as never)
    vi.spyOn(blocks, 'getBlock').mockResolvedValue({ chainId, number: 1000n, timestamp: 2000n })
    vi.spyOn(abiutil, 'load').mockResolvedValue(abi)
    vi.spyOn(prices, 'fetchErc20PriceUsd').mockResolvedValue({ priceUsd: 1 } as never)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => [] })))
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)
    const extractor = new SnapshotExtractor()
    extractor.resolveHooks = () => [{ abiPath: 'yearn/3/vault', type: 'snapshot', module: { default: process } }]
    const run = async () => {
      add.mockClear()
      await extractor.extract({
        abi: { abiPath: 'yearn/3/vault', sources: [], skip: false, only: false },
        source: { chainId, address: vault, inceptBlock: 0n, skip: false, only: false }
      })
      const load = add.mock.calls.find(([job]) => job === mq.job.load.snapshot)
      expect(load).toBeDefined()
      await upsertSnapshot(load![1])
      return (await db.query('SELECT hook FROM snapshot WHERE chain_id=$1 AND address=$2', [chainId, vault])).rows[0].hook
    }
    const before = await run()
    await addDeployment(unrelatedEmitter, forged, 999)
    // Prove this fixture selects the forged address under the old query.
    const vulnerable = await db.query(`SELECT args->>'allocator' AS allocator FROM evmlog
      WHERE chain_id=$1 AND signature=$2 AND args->>'vault'=$3
      ORDER BY block_number DESC,log_index DESC LIMIT 1`, [chainId, signature, vault])
    expect(vulnerable.rows[0].allocator).toBe(forged)

    const after = await run()
    expect(after.allocator).toBe(assigned)
    expect(after.debts).toEqual(before.debts)
    expect(after.composition).toEqual(before.composition)
    expect(after.debts[0]).toMatchObject({ targetDebtRatio: 250, maxDebtRatio: 500 })
    expect(after.composition[0]).toMatchObject({ targetDebtRatio: 250, maxDebtRatio: 500 })
    expect(readContract.mock.calls.filter(([call]) => call.functionName === 'getDebtAllocator').map(([call]) => call))
      .toEqual([expect.objectContaining({ address: manager, args: [vault], blockNumber: 1000n }),
        expect.objectContaining({ address: manager, args: [vault], blockNumber: 1000n })])
    // An unavailable manager must not activate the old event lookup either.
    readContract.mockRejectedValueOnce(new Error('Manager RPC unavailable'))
    await expect(run()).rejects.toThrow('Manager RPC unavailable')
    expect(add).not.toHaveBeenCalled()
    expect(targets).not.toContain(forged)
    expect(targets).not.toContain(unrelatedEmitter)
  })
})
