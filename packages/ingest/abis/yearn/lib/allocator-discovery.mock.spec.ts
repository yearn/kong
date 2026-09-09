import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, toEventSelector, zeroAddress } from 'viem'
import { mq } from 'lib'
import { estimateCreationBlock, getBlock } from 'lib/blocks'
import { rpcs } from '../../../rpcs'
import { first } from '../../../db'
import { discoverAllocator } from './allocator-discovery'
import assignmentHook, { topics } from '../3/roleManager/event/hook'
import factoryHook from '../3/sharedDebtAllocatorFactory/event/hook'
import managerSnapshot from '../3/roleManager/snapshot/hook'
import db from '../../../db'

vi.mock('lib', () => ({ mq: { add: vi.fn(), job: { load: { thing: { name: 'load.thing' } } } } }))
vi.mock('lib/blocks', () => ({ estimateCreationBlock: vi.fn(), getBlock: vi.fn() }))
vi.mock('../../../rpcs', () => ({ rpcs: { next: vi.fn() } }))
vi.mock('../../../db', () => ({ first: vi.fn(), default: { query: vi.fn() } }))

const manager = getAddress('0xb3bd6b2e61753c311efbcf0111f75d29706d9a41')
const vault = getAddress('0xbe53a109b494e5c9f97b9cd39fe969be68bf6204')
const allocator = getAddress('0x1e9eb053228b1156831759401de0e115356b8671')
const rpc = { getBytecode: vi.fn(), multicall: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(rpcs.next).mockReturnValue(rpc as unknown as ReturnType<typeof rpcs.next>)
  rpc.getBytecode.mockResolvedValue('0x1234')
  rpc.multicall.mockResolvedValue([{ result: vault }, { result: 6 }, { result: '3.0.2' }])
  vi.mocked(estimateCreationBlock).mockResolvedValue({ chainId: 1, number: 10n, timestamp: 100n })
  vi.mocked(getBlock).mockResolvedValue({ chainId: 1, number: 20n, timestamp: 200n })
  vi.mocked(first).mockResolvedValue({ hook: { project: { id: manager, name: 'Yearn' } } })
})
afterEach(() => vi.restoreAllMocks())

describe('Kong allocator discovery', () => {
  it('discovers an initial assignment and preserves vault discovery', async () => {
    await assignmentHook(1, manager, { eventName: 'AddedNewVault', blockNumber: 20n, args: { vault, debtAllocator: allocator, category: 1n } })
    expect(topics).toContain(toEventSelector('event AddedNewVault(address indexed vault,address indexed debtAllocator,uint256 category)'))
    expect(mq.add).toHaveBeenCalledWith(mq.job.load.thing, expect.objectContaining({ address: allocator, label: 'debtAllocator' }))
    expect(mq.add).toHaveBeenCalledWith(mq.job.load.thing, expect.objectContaining({ address: vault, label: 'vault' }))
  })
  it('discovers a replacement without treating it as a newly added vault', async () => {
    await assignmentHook(1, manager, { eventName: 'UpdateDebtAllocator', args: { vault, debtAllocator: allocator } })
    expect(topics).toContain(toEventSelector('event UpdateDebtAllocator(address indexed vault,address indexed debtAllocator)'))
    expect(mq.add).toHaveBeenCalledExactlyOnceWith(mq.job.load.thing, expect.objectContaining({ address: allocator, label: 'debtAllocator' }))
    expect(rpc.multicall).not.toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
  })
  it('discovers shared factory deployments without assigning governance as a vault', async () => {
    await factoryHook(1, manager, { args: { allocator, governance: manager } })
    expect(mq.add).toHaveBeenCalledExactlyOnceWith(mq.job.load.thing, {
      chainId: 1, address: allocator, label: 'debtAllocator', defaults: { inceptBlock: 10n, inceptTime: 100n }
    })
  })
  it('does not enqueue zero or no-code assignments as contracts', async () => {
    await discoverAllocator(1, zeroAddress)
    expect(rpc.getBytecode).not.toHaveBeenCalled()
    rpc.getBytecode.mockResolvedValue(undefined)
    await discoverAllocator(1, allocator)
    expect(mq.add).not.toHaveBeenCalled()
  })
  it('materializes a legacy manager project without querying a missing factory', async () => {
    vi.spyOn(db, 'query').mockResolvedValue({ rows: [{ defaults: {
      project: { id: manager, name: 'Yearn' }, inceptBlock: 19388998, inceptTime: 1709883383
    } }] } as never)
    expect(await managerSnapshot(1, manager, {})).toEqual({ project: { id: manager, name: 'Yearn', roleManager: manager } })
    expect(rpcs.next).not.toHaveBeenCalled()
  })
})
