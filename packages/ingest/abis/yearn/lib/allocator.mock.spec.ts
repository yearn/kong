import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseError, ContractFunctionExecutionError, createPublicClient, custom, encodeErrorResult, encodeFunctionResult, getAddress, parseAbi, zeroAddress, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { readVaultAllocator, selectAllocatorRatios } from './allocator'

const vault = '0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204' as Address
const manager = '0xb3bd6B2E61753C311EFbCF0111f75D29706D9a41' as Address
const allocator = '0x1e9eB053228B1156831759401dE0E115356b8671' as Address
const strategy = '0xf766c7293f4e0265ddfa8369f78a808df8ac70c1' as Address
const success = (result: bigint) => ({ status: 'success', result })
const fail = { status: 'failure', error: new ContractFunctionExecutionError(new BaseError('Getter unsupported'), {
  abi: parseAbi(['function getStrategyTargetRatio(address) view returns (uint256)']), functionName: 'getStrategyTargetRatio', args: [strategy]
}) }
const empty = { targetDebtRatio: null, maxDebtRatio: null }

afterEach(() => vi.restoreAllMocks())

describe('allocator ratio interface selection', () => {
  it.each([
    [success(0n), success(0n), fail, fail],
    [fail, fail, success(0n), success(0n)],
    [success(0n), success(0n), success(0n), success(0n)]
  ])('preserves valid zero pairs', (...calls) => {
    expect(selectAllocatorRatios(calls)).toEqual({ targetDebtRatio: 0, maxDebtRatio: 0 })
  })
  it('accepts matching successful pairs', () => {
    expect(selectAllocatorRatios([success(100n), success(200n), success(100n), success(200n)]))
      .toEqual({ targetDebtRatio: 100, maxDebtRatio: 200 })
  })
  it('rejects conflicting interfaces', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(selectAllocatorRatios([success(100n), success(200n), success(300n), success(400n)])).toEqual(empty)
    expect(warn).toHaveBeenCalledOnce()
  })
  it('never combines partial interfaces', () => {
    expect(selectAllocatorRatios([success(100n), fail, fail, success(200n)])).toEqual(empty)
  })
  it.each([10_001n, -1n, '100', undefined])('rejects invalid decoded ratios: %s', value => {
    expect(selectAllocatorRatios([{ status: 'success', result: value }, success(100n), fail, fail])).toEqual(empty)
  })
})

describe('current allocator reads', () => {
  const setup = () => {
    const rpc = { readContract: vi.fn().mockResolvedValue(allocator),
      multicall: vi.fn().mockResolvedValue([fail, fail, success(2870n), success(3444n)]) }
    const read = (selectedVault = vault, selectedManager: Address | undefined = manager) =>
      readVaultAllocator(selectedVault, selectedManager, [strategy], 20987762n, rpc as never)
    return { rpc, read }
  }
  it('reads the manager assignment and both ratio interfaces at the snapshot block', async () => {
    const { rpc, read } = setup()
    expect(await read()).toEqual({ address: allocator, ratios: { [strategy]: { targetDebtRatio: 2870, maxDebtRatio: 3444 } } })
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: manager,
      functionName: 'getDebtAllocator', args: [vault], blockNumber: 20987762n }))
    expect(rpc.multicall).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 20987762n, allowFailure: true,
      contracts: [expect.objectContaining({ address: allocator, args: [strategy] }), expect.objectContaining({ address: allocator, args: [strategy] }),
        expect.objectContaining({ address: allocator, args: [vault, strategy] }), expect.objectContaining({ address: allocator, args: [vault, strategy] })] }))
  })
  it('scopes two vaults using the same allocator to different ratios', async () => {
    const { rpc, read } = setup()
    const other = '0x1111111111111111111111111111111111111111' as Address
    const first = await read()
    rpc.multicall.mockResolvedValue([fail, fail, success(0n), success(100n)])
    const second = await read(other)
    expect(second.address).toBe(first.address)
    expect(second.ratios[strategy]).toEqual({ targetDebtRatio: 0, maxDebtRatio: 100 })
    expect(rpc.multicall.mock.calls[1][0].contracts[2].args).toEqual([other, strategy])
  })
  it('replaces the old address without reusing its ratios on interface failure', async () => {
    const { rpc, read } = setup()
    await read()
    const replacement = getAddress('0x2222222222222222222222222222222222222222')
    rpc.readContract.mockResolvedValue(replacement)
    rpc.multicall.mockResolvedValue([fail, fail, fail, fail])
    expect(await read()).toEqual({ address: replacement, ratios: { [strategy]: empty } })
  })
  it('clears a zero assignment without attempting ratio calls', async () => {
    const { rpc, read } = setup()
    rpc.readContract.mockResolvedValue(zeroAddress)
    expect(await read()).toEqual({ address: null, ratios: {} })
    expect(rpc.multicall).not.toHaveBeenCalled()
  })
  it('clears a zero manager without calling a contract', async () => {
    const { rpc, read } = setup()
    expect(await read(vault, zeroAddress)).toEqual({ address: null, ratios: {} })
    expect(rpc.readContract).not.toHaveBeenCalled()
  })
  it('fails required missing manager reads', async () => {
    await expect(readVaultAllocator(vault, undefined, [strategy], 1n, {} as never)).rejects.toThrow('role manager')
  })
  it.each(['readContract', 'multicall'] as const)('propagates transport failure in %s for snapshot retry', async method => {
    const { rpc, read } = setup()
    rpc[method].mockRejectedValue(new Error('RPC unavailable'))
    await expect(read()).rejects.toThrow('RPC unavailable')
    if (method === 'readContract') expect(rpc.multicall).not.toHaveBeenCalled()
  })
  it('does not retain an old assignment when a new manager returns no contract data', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => '0x' }, { retryCount: 0 }) })
    expect(await readVaultAllocator(vault, manager, [strategy], 20987762n, client)).toEqual({ address: null, ratios: {} })
  })
  it.each([undefined, '0x'])('rejects provider internal errors with data %s instead of clearing the assignment', async data => {
    const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => {
      throw Object.assign(new Error('Internal error'), { code: -32603, data })
    } }, { retryCount: 0 }) })
    await expect(readVaultAllocator(vault, manager, [strategy], 20987762n, client)).rejects.toThrow('Internal error')
  })
  it.each([
    { code: 3, message: 'execution reverted', data: '0x' },
    { code: -32603, message: 'execution reverted', data: '0x' },
    { code: -32603, message: 'Internal error', data: encodeErrorResult({
      abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['Getter unsupported']
    }) },
    { code: 3, message: 'execution reverted', data: '0x12345678' }
  ])('clears an unsupported assignment getter with contract revert evidence: %j', async ({ code, message, data }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => {
      throw Object.assign(new Error(message), { code, data })
    } }, { retryCount: 0 }) })
    expect(await readVaultAllocator(vault, manager, [strategy], 20987762n, client)).toEqual({ address: null, ratios: {} })
  })
  it('retries an aggregate transport failure even when viem returns per-call failures', async () => {
    let calls = 0
    const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => {
      if (++calls === 1) return encodeFunctionResult({ abi: parseAbi(['function getDebtAllocator(address) view returns (address)']),
        functionName: 'getDebtAllocator', result: allocator })
      throw new Error('Aggregate RPC unavailable')
    } }, { retryCount: 0 }) })
    await expect(readVaultAllocator(vault, manager, [strategy], 20987762n, client)).rejects.toThrow('Aggregate RPC unavailable')
    expect(calls).toBe(2)
  })
})
