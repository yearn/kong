import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, zeroAddress, type Address } from 'viem'
import { blockEndPosition, resolveAllocatorAssignment } from 'lib/allocators'
import { mergeAllocatorHook, allocatorSnapshotFields } from 'lib/allocator-snapshot'
import { allocatorRatioCalls, projectCurrentAllocator, ratioValue } from './allocators'

const vault = '0xbe53a109b494e5c9f97b9cd39fe969be68bf6204' as Address
const manager = '0xb3bd6b2e61753c311efbcf0111f75d29706d9a41' as Address
const old = '0x1400d5c76d0a630368c8548172e5130983aaa0ef' as Address
const shared = '0x1e9eb053228b1156831759401de0e115356b8671' as Address
const custom = '0x1111111111111111111111111111111111111111' as Address
const strategy = '0xf766c7293f4e0265ddfa8369f78a808df8ac70c1' as Address
const blockHash = `0x${'a'.repeat(64)}`
const block = 20987762
const boundFactory = '0xfcf8c7c43dedd567083b422d6770f23b78d15bde'
const sharedFactory = '0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18'

function assignment(address: Address, eventName = 'UpdateDebtAllocator', logIndex = 422, blockNumber = block) {
  return { id: `assignment:${blockNumber}:${logIndex}`, chainId: 1, vaultAddress: vault, sourceAddress: manager,
    eventName, argsJson: JSON.stringify({ vault, debtAllocator: address }), normalizationVersion: 3,
    blockHash, blockNumber, transactionIndex: 163, logIndex }
}

function setup({ chainId = 1, address = shared, family = 'shared', rows = [assignment(old, 'AddedNewVault', 1, block - 1), assignment(address)] } = {}) {
  const rpc = {
    getBlock: vi.fn(async () => ({ number: BigInt(block), hash: blockHash })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === 'role_manager' ? manager : address),
    getBytecode: vi.fn(async () => '0x1234'),
    multicall: vi.fn(async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: 'success', result: 0n })))
  }
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { query } = JSON.parse(init.body)
    const data = query.includes('AllocatorHead') ? { chain_metadata: [{ chain_id: chainId, start_block: 0, latest_processed_block: block }] }
      : query.includes('AllocatorAssignments') ? { items: rows.map(row => ({ ...row, chainId })) }
        : { bound: family === 'vault_bound' ? [{ allocatorAddress: address, vaultAddress: vault, factoryAddress: boundFactory, abiVariant: 'generic-v1', createdBlock: 1, createdEventId: 'created' }] : [],
          shared: family === 'shared' ? [{ allocatorAddress: address, governanceAddress: custom, factoryAddress: sharedFactory, abiVariant: 'shared-v1', createdBlock: 1, createdEventId: 'created' }] : [] }
    return { ok: true, json: async () => ({ data }) }
  }))
  return { rpc, run: () => projectCurrentAllocator(chainId, vault, [strategy], rpc as unknown as Parameters<typeof projectCurrentAllocator>[3]) }
}

beforeEach(() => {
  vi.stubEnv('ENVIO_ALLOCATION_GRAPHQL_URL', 'https://envio.example.invalid/graphql')
  vi.stubEnv('ENVIO_ALLOCATOR_SOURCE_REVISION', 'fixture-normalization-v3')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('current Envio allocator projection', () => {
  it.each([1, 8453, 747474])('projects a shared replacement on chain %i with zero ratios', async chainId => {
    const { rpc, run } = setup({ chainId })
    const result = await run()
    expect(result).toMatchObject({ address: getAddress(shared), family: 'shared', support: 'supported', asOfBlock: block,
      ratios: { [strategy]: { targetDebtRatio: 0, maxDebtRatio: 0 } } })
    expect(result.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(rpc.multicall.mock.calls[0][0]).toMatchObject({ blockNumber: BigInt(block), contracts: [
      { args: [vault, strategy], functionName: 'getStrategyTargetRatio' },
      { args: [vault, strategy], functionName: 'getStrategyMaxRatio' }
    ] })
  })
  it('uses one-address getters for a vault-bound allocator', async () => {
    const { rpc, run } = setup({ family: 'vault_bound', address: old })
    expect((await run()).family).toBe('vault_bound')
    expect(rpc.multicall.mock.calls[0][0].contracts).toMatchObject([{ args: [strategy] }, { args: [strategy] }])
  })
  it('preserves initial custom assignments with no code', async () => {
    const { rpc, run } = setup({ family: 'unknown', address: custom, rows: [assignment(custom, 'AddedNewVault')] })
    rpc.getBytecode.mockResolvedValue('0x')
    expect(await run()).toMatchObject({ address: getAddress(custom), status: 'assigned', support: 'no_code', ratios: {} })
    expect(rpc.multicall).not.toHaveBeenCalled()
  })
  it('distinguishes unsupported custom contracts, failed RPC, and explicit zero clears', async () => {
    expect(await setup({ family: 'unknown', address: custom }).run()).toMatchObject({ address: getAddress(custom), support: 'unsupported' })
    const failed = setup()
    failed.rpc.multicall.mockRejectedValue(new Error('provider failure'))
    expect(await failed.run()).toMatchObject({ address: getAddress(shared), support: 'unavailable', ratios: {} })
    expect(await setup({ address: zeroAddress, family: 'unknown' }).run()).toMatchObject({ address: null, status: 'cleared' })
  })
  it('rejects incomplete assignment evidence and a mismatch with current manager state', async () => {
    expect(await setup({ rows: [] }).run()).toMatchObject({ status: 'unavailable', address: null, revision: null })
    const { rpc, run } = setup()
    rpc.readContract.mockImplementation(async ({ functionName }) => functionName === 'role_manager' ? manager : custom)
    expect(await run()).toMatchObject({ status: 'unavailable', address: null, revision: null })
  })
  it('resolves the Kong #471 replacement at its full event position', () => {
    const rows = [assignment(old, 'AddedNewVault', 1, block - 1), assignment(shared)].map(row => ({ ...row, args: JSON.parse(row.argsJson) }))
    const before = { ...blockEndPosition(block), transactionIndex: 163, logIndex: 421 }
    const resolve = (at: typeof before) => resolveAllocatorAssignment({ vaultAddress: vault, events: rows, at, roleManagerAddress: manager })
    expect(resolve(before).address).toBe(old)
    expect(resolve({ ...before, logIndex: 422 }).address).toBe(shared)
  })
  it('removes a vault and does not use an old manager after migration', async () => {
    const { run } = setup({ address: zeroAddress, family: 'unknown', rows: [assignment(old, 'AddedNewVault', 1), assignment(zeroAddress, 'RemovedVault', 2)] })
    expect(await run()).toMatchObject({ address: null, reason: 'vault_removed_from_role_manager' })
    const rows = [assignment(old), { ...assignment(custom, 'UpdateRoleManager', 11), sourceAddress: vault, argsJson: JSON.stringify({ roleManager: custom }) }]
    expect(await setup({ rows }).run()).toMatchObject({ address: null, status: 'unavailable' })
  })
})

describe('allocator snapshot activation', () => {
  it('clears old targets on replacement and keeps delayed jobs from rolling back the revision', () => {
    const current = { allocator: old, allocatorState: { schemaVersion: 1, address: old, revision: 'old', asOfBlock: 1,
      observedAt: '2026-01-01', ratios: { [strategy]: { targetDebtRatio: 5000, maxDebtRatio: 6000 } } },
    debts: [{ strategy, currentDebt: '50', targetDebtRatio: 5000, maxDebtRatio: 6000 }] }
    const incoming = { allocatorState: { schemaVersion: 1, address: custom, revision: 'new', asOfBlock: 2, observedAt: '2026-01-02', ratios: {} } }
    const active = mergeAllocatorHook(current, incoming)
    expect(active).toMatchObject({ allocator: custom, debts: [{ currentDebt: '50', targetDebtRatio: null, maxDebtRatio: null }] })
    expect(mergeAllocatorHook(active, current)).toMatchObject({ allocator: custom, allocatorState: { revision: 'new' }, debts: [{ targetDebtRatio: null }] })
    expect(allocatorSnapshotFields(current).allocator).toBe(old)
  })
  it('never exposes a legacy factory projection and treats failed ratios as unavailable', () => {
    expect(allocatorSnapshotFields({ allocator: sharedFactory })).toMatchObject({ allocator: null, allocatorState: { reason: 'not_materialized' } })
    expect(ratioValue({ status: 'success', result: 0n })).toBe(0)
    expect(ratioValue({ status: 'failure' })).toBeNull()
    expect(allocatorRatioCalls('unknown', custom, vault, strategy)).toEqual([])
  })
})
