import { setTimeout } from 'timers/promises'
import { createHash } from 'crypto'
import { toEventSelector } from 'viem'
import { mq, strider } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { estimateHeight, getBlockNumber } from 'lib/blocks'
import { Stride } from 'lib/types'
import blacklist from 'lib/blacklist'
import { adoptLegacyStrides, getTravelledStrides } from '../db'
import abiutil from '../abiutil'
import { gnosis, polygon, fantom } from 'viem/chains'

const LOG_STRIDES: {
  [key: number]: number
} = {
  [gnosis.id]: 5_000,
  [polygon.id]: 3_000,
  [fantom.id]: 5_000
}

function getLogStride(chainId: number) {
  return LOG_STRIDES[chainId] || Number(process.env.LOG_STRIDE || false) || 10_000
}

type Reader = { abi: AbiConfig, source: SourceConfig }

export default class EventsFanout {
  async fanout(data: { readers?: Reader[], abi?: AbiConfig, source?: SourceConfig, replay?: { enabled: boolean, since?: bigint } }) {
    const readers = data.readers ?? [{ abi: data.abi!, source: data.source! }]
    const { chainId, address } = SourceConfigSchema.parse(readers[0].source)
    const { replay } = data

    const abiPaths: string[] = []
    const ranges: Record<string, Stride> = {}
    for (const reader of readers) {
      const { inceptBlock, startBlock, endBlock } = SourceConfigSchema.parse(reader.source)
      const { abiPath } = AbiConfigSchema.parse(reader.abi)
      abiPaths.push(abiPath)

      const from = replay?.enabled && replay?.since
        ? await estimateHeight(chainId, replay?.since)
        : startBlock ?? inceptBlock
      const to = endBlock ?? await getBlockNumber(chainId)

      const events = abiutil.exclude(blacklist.events.ignore, abiutil.events(await abiutil.load(abiPath)))
      for (const event of events) {
        const signature = toEventSelector(event)
        const range = ranges[signature]
        ranges[signature] = range
          ? { from: range.from < from ? range.from : from, to: range.to > to ? range.to : to }
          : { from, to }
      }
    }

    const signatures = Object.keys(ranges)
    if (!replay?.enabled) await adoptLegacyStrides(chainId, address, signatures)
    const travelled = replay?.enabled ? {} : await getTravelledStrides(chainId, address, signatures)

    const missing = Object.fromEntries(signatures.map(signature => [
      signature, strider.plan(ranges[signature].from, ranges[signature].to, travelled[signature])
    ]))
    const union = Object.values(missing).flat().reduce<Stride[]>((acc, stride) => strider.add(stride, acc), [])

    for (const stride of union) {
      console.log('📤', 'stride', chainId, address, stride.from, stride.to)
      await walklog({ ...stride, logStride: getLogStride(chainId) }, async (from, to) => {
        const chunkSignatures = signatures.filter(signature =>
          missing[signature].some(m => m.from <= to && m.to >= from))
        if (chunkSignatures.length === 0) return
        const hash = createHash('sha1').update([...abiPaths, ...chunkSignatures.sort()].join()).digest('hex').slice(0, 12)
        const jobId = `evmlog-${chainId}-${address}-${from}-${to}-${hash}`
        await mq.add(mq.job.extract.evmlog, {
          abiPaths, signatures: chunkSignatures, chainId, address, from, to, replay: replay?.enabled
        }, { jobId })
      })
    }
  }
}

async function walklog(
  o: { from: bigint, to: bigint, logStride: number },
  f: (from: bigint, to: bigint) => Promise<void>
) {
  const logStride = BigInt(o.logStride)
  for (let fromBlock = o.from; fromBlock <= o.to; fromBlock += logStride) {
    const toBlock = fromBlock + logStride - 1n < o.to ? fromBlock + logStride - 1n : o.to
    await f(fromBlock, toBlock)
    await setTimeout(16)
  }
}
