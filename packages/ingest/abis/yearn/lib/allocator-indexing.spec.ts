import { describe, expect, it, vi } from 'vitest'
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getAddress, parseAbi, toEventSelector } from 'viem'
import { abis } from 'lib/abis'
import manuals from 'lib/manuals'
import { upsertEvmLog } from '../../../load'
import db from '../../../db'
import { loadAllocatorAssignments, projectCurrentAllocator } from '../../../allocators'
import allocatorAbi from '../3/debtAllocator/abi'
import managerAbi from '../3/roleManager/abi'
import factoryAbi from '../3/sharedDebtAllocatorFactory/abi'

const vault = getAddress('0xbe53a109b494e5c9f97b9cd39fe969be68bf6204')
const manager = getAddress('0xb3bd6b2e61753c311efbcf0111f75d29706d9a41')
const allocator = getAddress('0x1e9eb053228b1156831759401de0e115356b8671')
const factory = getAddress('0x03d43df6ff894c848fc6f1a0a7e8a539ef9a4c18')
const strategy = getAddress('0xf766c7293f4e0265ddfa8369f78a808df8ac70c1')
const block = 20987762n

describe('allocator events in Kong', () => {
  it('loads and resolves decoded manager/factory events and stores shared ratio logs', async () => {
    expect(manuals).toEqual(expect.arrayContaining([expect.objectContaining({ chainId: 1, address: manager, label: 'roleManager' })]))
    expect(abis.find(abi => abi.abiPath === 'yearn/3/sharedDebtAllocatorFactory')?.sources)
      .toEqual(expect.arrayContaining([expect.objectContaining({ chainId: 1, address: factory })]))
    const assignmentTopics = encodeEventTopics({ abi: managerAbi, eventName: 'UpdateDebtAllocator', args: { vault, debtAllocator: allocator } })
    const deploymentTopics = encodeEventTopics({ abi: factoryAbi, eventName: 'NewDebtAllocator', args: { allocator, governance: manager } })
    const ratioTopics = encodeEventTopics({ abi: parseAbi(['event UpdateStrategyDebtRatio(address indexed vault,address indexed strategy,uint256 newTargetRatio,uint256 newMaxRatio,uint256 newTotalDebtRatio)']),
      eventName: 'UpdateStrategyDebtRatio', args: { vault, strategy } })
    const ratioData = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [0n, 100n, 100n])
    const logs = [
      { address: manager, decoded: decodeEventLog({ abi: managerAbi, topics: [assignmentTopics[0], ...assignmentTopics.slice(1)], data: '0x' }), topics: assignmentTopics, logIndex: 422 },
      { address: factory, decoded: decodeEventLog({ abi: factoryAbi, topics: [deploymentTopics[0], ...deploymentTopics.slice(1)], data: '0x' }), topics: deploymentTopics, logIndex: 1 },
      { address: allocator, decoded: decodeEventLog({ abi: allocatorAbi, topics: [ratioTopics[0], ...ratioTopics.slice(1)], data: ratioData }), topics: ratioTopics, logIndex: 423 }
    ]
    try {
      for (const log of logs) {
        await upsertEvmLog({ chainId: 1, address: log.address, from: block, to: block, batch: [{
          chainId: 1, address: log.address, ...log.decoded, signature: log.topics[0], topics: log.topics, hook: {},
          blockNumber: block, blockTime: 1729200000n, transactionIndex: 163, logIndex: log.logIndex, transactionHash: `0x${'a'.repeat(64)}`
        }] })
      }
      const rows = await loadAllocatorAssignments(1, vault, Number(block), manager)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ eventName: 'UpdateDebtAllocator', sourceAddress: manager.toLowerCase(), args: { debtAllocator: allocator } })
      const rpc = {
        getBlock: vi.fn(async () => ({ number: block, hash: `0x${'b'.repeat(64)}` })),
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => functionName === 'role_manager' ? manager : allocator),
        getBytecode: vi.fn(async () => '0x1234'),
        multicall: vi.fn(async () => [{ status: 'success', result: 0n }, { status: 'success', result: 100n }])
      }
      const projection = await projectCurrentAllocator(1, vault, [strategy], rpc as unknown as Parameters<typeof projectCurrentAllocator>[3])
      expect(projection).toMatchObject({ address: allocator, family: 'shared', sourceRevision: 'kong-evmlog-v1', support: 'supported',
        ratios: { [strategy.toLowerCase()]: { targetDebtRatio: 0, maxDebtRatio: 100 } } })
      const indexed = await db.query('SELECT args FROM evmlog WHERE chain_id=1 AND address=$1 AND signature=$2',
        [allocator, toEventSelector('UpdateStrategyDebtRatio(address,address,uint256,uint256,uint256)')])
      expect(indexed.rows[0].args).toMatchObject({ vault, strategy, newTargetRatio: '0', newMaxRatio: '100' })
    } finally {
      await db.query('DELETE FROM evmlog WHERE chain_id=1 AND transaction_hash=$1', [`0x${'a'.repeat(64)}`])
      await db.query('DELETE FROM evmlog_strides WHERE chain_id=1 AND address=ANY($1::text[])', [[manager, factory, allocator]])
    }
  })
})
