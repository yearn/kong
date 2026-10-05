import { z } from 'zod'
import { setTimeout } from 'timers/promises'
import { mq, strider } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { estimateHeight, getBlockNumber } from 'lib/blocks'
import { getTravelledStrides } from '../db'
import { StrideSchema } from 'lib/types'
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

export default class EventsFanout {
  async fanout(data: { abi: AbiConfig, source: SourceConfig, replay?: { enabled: boolean, since?: bigint }, ignoreStrides?: boolean, discoveryRepair?: boolean, repairBlock?: bigint | string }) {
    const { chainId, address, inceptBlock, startBlock, endBlock } = SourceConfigSchema.parse(data.source)
    const { abiPath } = AbiConfigSchema.parse(data.abi)
    const { replay, ignoreStrides } = data
    const from = replay?.enabled && replay?.since
      ? await estimateHeight(chainId, replay.since)
      : startBlock ?? inceptBlock
    const to = endBlock ?? await getBlockNumber(chainId)
    const logStride = getLogStride(chainId)
    if (!Number.isSafeInteger(logStride) || logStride <= 0) throw new Error('invalid log stride')
    // One minute per full-history chunk plus a 15-minute loading margin.
    // Large backfills must not be re-admitted on every cron tick.
    const chunks = to >= from ? Number((to - from) / BigInt(logStride) + 1n) : 0
    const repairWindowSeconds = 900 + chunks * 60
    let repairToken: string | undefined
    if (data.discoveryRepair) {
      const minimumBlock = data.repairBlock === undefined ? undefined : z.bigint({ coerce: true }).nonnegative().parse(data.repairBlock)
      const admission = await mq.reserveDiscoveryRepair(chainId, address, minimumBlock, repairWindowSeconds)
      if (admission.status !== 'granted') {
        console.info('DISCOVERY_REPAIR_DEFERRED', { chainId, address, reason: admission.status })
        return
      }
      repairToken = admission.token
    }
    try {

      const replayRange = undefined // [{ from: 19309874n, to: 19309874n }]
      const travelled = replay?.enabled || ignoreStrides ? undefined : await getTravelledStrides(chainId, address)
      const nextStrides = replayRange ? replayRange : strider.plan(from, to, travelled)

      for (const stride of StrideSchema.array().parse(nextStrides)) {
        console.log('📤', 'stride', chainId, address, stride.from, stride.to)
        await walklog({...stride, logStride}, async (from, to) => {
          const jobId = `evmlog-${abiPath}-${chainId}-${address}-${from}-${to}`
          await mq.add(mq.job.extract.evmlog, {
            abiPath, chainId, address, from, to, replay: replay?.enabled
          }, { jobId })
        })
      }
      if (repairToken) await mq.finishDiscoveryRepair(chainId, address, repairToken, true, repairWindowSeconds)
    } catch (error) {
      if (repairToken) {
        try { await mq.finishDiscoveryRepair(chainId, address, repairToken, false, repairWindowSeconds) }
        catch (releaseError) { console.error('DISCOVERY_REPAIR_RELEASE_FAILED', releaseError) }
      }
      throw error
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
