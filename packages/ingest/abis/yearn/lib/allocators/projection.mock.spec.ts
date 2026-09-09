import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, zeroAddress, type Address } from 'viem'
import { blockEndPosition, resolveAllocatorAssignment } from 'lib/allocators'
import { mergeAllocatorHook, allocatorSnapshotFields } from 'lib/allocator-snapshot'
const database = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../../../../db', () => ({ default: database }))
import { allocatorRatioCalls, projectCurrentAllocator, ratioValue } from './projection'

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
    eventName, argsJson: JSON.stringify({ vault, debtAllocator: address }),
    blockNumber, transactionIndex: 163, logIndex }
}

function setup({ chainId = 1, vaultAddress = vault, address = shared, family = 'shared', rows = [assignment(old, 'AddedNewVault', 1, block - 1), assignment(address)] } = {}) {
  const rpc = {
    getBlock: vi.fn(async () => ({ number: BigInt(block), hash: blockHash })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === 'role_manager' ? manager : address),
    getBytecode: vi.fn(async () => '0x1234'),
    multicall: vi.fn(async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => ({ status: 'success', result: 0n })))
  }
  database.query.mockImplementation(async (sql: string, params: unknown[]) => {
    expect(params[0]).toBe(chainId)
    if (sql.includes('AS "sourceAddress"')) {
      expect(params[1]).toBe(vaultAddress)
      return { rows: rows.map(row => ({ ...row, args: JSON.parse(row.argsJson) })) }
    }
    return { rows: family === 'unknown' ? [] : [{ address: family === 'shared' ? sharedFactory
      : chainId === 137 ? '0x0d1f62247035bbff16742b0f31e8e2af3acd6e67' : boundFactory,
    args: { allocator: address, ...(family === 'shared' ? { governance: custom } : { vault: vaultAddress }) },
    createdBlock: 1, id: 'created' }] }
  })
  return { rpc, run: () => projectCurrentAllocator(chainId, vaultAddress, [strategy], rpc as unknown as Parameters<typeof projectCurrentAllocator>[3]) }
}

beforeEach(() => {
  database.query.mockReset()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external indexer request') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

describe('current Kong allocator projection', () => {
  it.each([1, 137, 8453, 747474])('projects a shared replacement on chain %i with zero ratios', async chainId => {
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
  it.each([100, 137])('uses Kong factory configuration on chain %i', async chainId => {
    expect(await setup({ chainId, family: 'vault_bound', address: old }).run()).toMatchObject({
      address: getAddress(old), family: 'vault_bound', support: 'supported', sourceRevision: 'kong-evmlog-v1'
    })
  })
  it('scopes two vaults sharing one allocator to their own ratio calls', async () => {
    for (const selectedVault of [vault, custom]) {
      const row = { ...assignment(shared), vaultAddress: selectedVault, argsJson: JSON.stringify({ vault: selectedVault, debtAllocator: shared }) }
      const { rpc, run } = setup({ vaultAddress: selectedVault, rows: [row] })
      expect(await run()).toMatchObject({ vault: selectedVault, address: getAddress(shared), support: 'supported' })
      expect(rpc.multicall.mock.calls[0][0]).toMatchObject({ contracts: [
        { args: [selectedVault, strategy] }, { args: [selectedVault, strategy] }
      ] })
    }
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
  it('leaves legacy Gnosis controllers without assignment logs unavailable', async () => {
    const { rpc, run } = setup({ chainId: 100, family: 'vault_bound', address: old, rows: [] })
    expect(await run()).toMatchObject({ address: null, status: 'unavailable', revision: null })
    expect(rpc.multicall).not.toHaveBeenCalled()
    // A stored factory deployment cannot supply a missing manager assignment.
    expect(database.query).toHaveBeenCalledTimes(1)
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
  it.each([20, 21])('rejects older recovery after outages and accepts validated recovery at block %i', recoveryBlock => {
    // Start with a previously stored projection that predates the persistent block guard.
    const current = { allocatorState: { schemaVersion: 1, address: shared, revision: 'accepted', asOfBlock: 20,
      observedAt: '2026-09-08T00:00:00Z', ratios: { [strategy]: { targetDebtRatio: 0, maxDebtRatio: 100 } } },
    debts: [{ strategy, currentDebt: '50' }], composition: [{ address: strategy, currentDebt: '50' }] }
    const failedState = { schemaVersion: 1, address: null, revision: null, asOfBlock: 0,
      observedAt: '2026-09-08T00:01:00Z', status: 'unavailable', ratios: {} }
    const unavailable = mergeAllocatorHook(current, { allocatorState: failedState })
    expect(unavailable).toMatchObject({ allocator: shared, allocatorState: { stale: true, revision: 'accepted' },
      debts: [{ currentDebt: '50', targetDebtRatio: 0, maxDebtRatio: 100 }],
      composition: [{ currentDebt: '50', targetDebtRatio: 0, maxDebtRatio: 100 }] })

    const olderRecovery = { ...current.allocatorState, address: old, revision: 'older', asOfBlock: 10,
      observedAt: '2026-09-08T00:02:00Z' }
    const rejected = mergeAllocatorHook(unavailable, { allocatorState: olderRecovery })
    expect(rejected).toMatchObject({ allocator: shared, allocatorState: { stale: true, revision: 'accepted' },
      debts: [{ targetDebtRatio: 0, maxDebtRatio: 100 }],
      composition: [{ targetDebtRatio: 0, maxDebtRatio: 100 }] })

    // A failed read after selecting a higher block must not advance the accepted block.
    const failedAgain = mergeAllocatorHook(rejected, {
      allocatorState: { ...failedState, asOfBlock: 30, observedAt: '2026-09-08T00:03:00Z' }
    })
    const recovered = mergeAllocatorHook(failedAgain, { allocatorState: {
      ...current.allocatorState, asOfBlock: recoveryBlock, revision: 'recovered', observedAt: '2026-09-08T00:04:00Z'
    } })
    expect(recovered).toMatchObject({ allocator: shared, allocatorState: { revision: 'recovered' },
      debts: [{ currentDebt: '50', targetDebtRatio: 0, maxDebtRatio: 100 }],
      composition: [{ currentDebt: '50', targetDebtRatio: 0, maxDebtRatio: 100 }] })

    expect(recovered.allocatorState).not.toHaveProperty('stale')
    const cleared = mergeAllocatorHook(recovered, { allocatorState: { ...failedState,
      status: 'cleared', revision: 'cleared', asOfBlock: recoveryBlock + 1, observedAt: '2026-09-08T00:05:00Z' } })
    expect(mergeAllocatorHook(cleared, { allocatorState: { ...current.allocatorState,
      asOfBlock: recoveryBlock, observedAt: '2026-09-08T00:06:00Z' } })).toMatchObject({
      allocator: null, allocatorState: { status: 'cleared', revision: 'cleared' }
    })
  })
  it('retains ratios on a configuration outage only for the same assignment and rejects late successes', () => {
    const accepted = { schemaVersion: 1, address: shared, assignmentId: 'assigned', roleManagerAddress: manager,
      revision: 'accepted', asOfBlock: 20, observedAt: '2026-01-01T00:00:00Z', support: 'supported',
      ratios: { [strategy]: { targetDebtRatio: 0, maxDebtRatio: 100 } } }
    const failed = { ...accepted, revision: 'failed-config', support: 'unavailable', reason: 'allocator_configuration_unavailable',
      observedAt: '2026-01-01T00:02:00Z', ratios: {} }
    const stale = mergeAllocatorHook({ allocatorState: accepted }, { allocatorState: failed })
    expect(stale.allocatorState).toMatchObject({ revision: 'accepted', stale: true,
      lastAttemptAt: failed.observedAt, lastError: failed.reason, ratios: accepted.ratios })
    expect(mergeAllocatorHook(stale, { allocatorState: { ...accepted, observedAt: '2026-01-01T00:01:00Z' } }).allocatorState)
      .toEqual(stale.allocatorState)
    for (const replacement of [{ address: custom }, { assignmentId: 'reassigned' }]) {
      expect(mergeAllocatorHook(stale, { allocatorState: { ...failed, ...replacement } }).allocatorState)
        .toMatchObject({ revision: 'failed-config', ratios: {} })
    }
    expect(mergeAllocatorHook({}, { allocatorState: { ...failed, revision: null, address: null } }))
      .toMatchObject({ allocator: null })
  })
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
