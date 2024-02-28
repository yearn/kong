import { Queue } from 'bullmq'
import { Processor } from 'lib/processor'
import { abiutil, mq } from 'lib'
import { Contract, ContractSchema, SourceConfig, SourceConfigSchema } from 'lib/contracts'
import { rpcs } from 'lib/rpcs'
import { getBlock } from 'lib/blocks'
import resolveModules from 'lib/resolveModules'
import path from 'path'
import { removeLeadingSlash } from 'lib/strings'
import { SnapshotSchema } from 'lib/types'

export interface Hook extends Processor {
  process: (chainId: number, address: `0x${string}`, snapshot: any) => Promise<any|undefined>
}

export class SnapshotExtractor implements Processor {
  queues: { [key: string]: Queue } = {}
  postprocessors: {
    abiPath: string,
    hook: Hook
  }[] = []

  async up() {
    await resolveModules(path.join(__dirname, 'hooks'), (modulePath: string, module: any) => {
      const abiPath = removeLeadingSlash(modulePath.replace(path.join(__dirname, 'hooks'), '').replace('.ts', ''))
      this.postprocessors.push({ abiPath, hook: new module.default() })
    })
    this.queues[mq.q.load] = mq.queue(mq.q.load)
  }

  async down() {
    await Promise.all(Object.values(this.queues).map(q => q.close()))
    await Promise.all(Object.values(this.postprocessors).map(p => p.hook.down()))
  }

  async extract(data: { contract: Contract, source: SourceConfig }) {
    const { chainId, address } = SourceConfigSchema.parse(data.source)
    const { abiPath } = ContractSchema.parse(data.contract)

    const abi = await abiutil.load(abiPath)
    const fields = abiutil.fields(abi)
    const postprocessor = this.postprocessors.find(p => p.abiPath === abiPath)

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

    const post = postprocessor 
    ? await postprocessor.hook.process(chainId, address, _snapshot) || {}
    : {}

    const snapshot = SnapshotSchema.parse({
      chainId,
      address,
      snapshot: _snapshot,
      post,
      blockNumber: block.number,
      blockTime: block.timestamp
    })

    this.queues[mq.q.load].add(mq.job.load.snapshot, snapshot)
  }
}