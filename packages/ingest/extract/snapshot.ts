import { mq } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { rpcs } from 'lib/rpcs'
import { getBlock } from 'lib/blocks'
import { SnapshotSchema } from 'lib/types'
import { ResolveHooks } from '../abis/types'
import { requireHooks } from '../abis'
import abiutil from '../abiutil'

export class SnapshotExtractor {
  resolveHooks: ResolveHooks | undefined

  async extract(data: { abi: AbiConfig, source: SourceConfig }) {
    console.log('📸', data.abi.abiPath, data.source.chainId, data.source.address)

    if(!this.resolveHooks) this.resolveHooks = await requireHooks()

    const { chainId, address } = SourceConfigSchema.parse(data.source)
    const { abiPath } = AbiConfigSchema.parse(data.abi)

    const abi = await abiutil.load(abiPath)
    const fields = abiutil.fields(abi)

    const contracts = fields.map((f: any) => ({
      address, abi: [f], functionName: f.name
    }))

    const block = await getBlock(chainId)
    const multicall = await rpcs.next(chainId).multicall({ contracts, blockNumber: block.number })

    const _snapshot: { [key: string]: any } = {
      blockNumber: block.number,
      blockTime: block.timestamp
    }

    const kvps = fields.map((f: any, index: number) => ({ key: f.name, value: multicall[index].result }))
    for (const { key, value } of kvps) {
      _snapshot[key] = value
    }

    let hookResult = {}
    const hooks = this.resolveHooks(abiPath, 'snapshot')
    for (const hook of hooks) {
      hookResult = {
        ...hookResult,
        ...await hook.module.default(chainId, address, _snapshot)
      }
    }

    await mq.add(mq.job.load.snapshot, SnapshotSchema.parse({
      chainId,
      address,
      snapshot: _snapshot,
      hook: hookResult,
      blockNumber: block.number,
      blockTime: block.timestamp
    }))
  }
}
