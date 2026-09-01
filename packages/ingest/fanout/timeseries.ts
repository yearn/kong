import { math, mq, multicall3 } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { getBlockNumber, getBlockTime, getDefaultStartBlockNumber } from 'lib/blocks'
import db from '../db'
import { requireHooks } from '../abis'
import { ResolveHooks } from '../abis/types'
import { endOfDay, makeTimeline } from 'lib/dates'

export default class TimeseriesFanout {
  resolveHooks: ResolveHooks | undefined

  async fanout(data: { abi: AbiConfig, source: SourceConfig, replay?: { enabled: boolean, since?: bigint } }) {
    if (!this.resolveHooks) this.resolveHooks = await requireHooks()
    const { chainId, address, inceptBlock, startBlock, endBlock } = SourceConfigSchema.parse(data.source)
    const { abiPath } = AbiConfigSchema.parse(data.abi)
    const multicall3Activation = multicall3.getActivation(chainId)
    const defaultStartBlockNumber = await getDefaultStartBlockNumber(chainId)

    const hooks = this.resolveHooks(abiPath, 'timeseries')
    for (const hook of hooks) {
      const outputLabel = hook.module.outputLabel

      const from = startBlock !== undefined
        ? startBlock
        : math.max(inceptBlock, defaultStartBlockNumber, multicall3Activation)
      const to = endBlock !== undefined ? endBlock : await getBlockNumber(chainId)
      const start = endOfDay(await getBlockTime(chainId, from))
      const end = endOfDay(await getBlockTime(chainId, to))

      // Null tvl/tvl-c USD rows (price-service 5xx → unavailable) are treated as missing
      // so they heal when the service recovers. jobId dedupe prevents stacking in-flight
      // copies; negative price cache (#463) stops a service stampede. Other labels still
      // treat any row as computed so #462's apy/pps loop does not return. Replay still
      // clears negative price-cache markers first.
      const missing = data.replay?.enabled
        ? makeTimeline(data.replay.since ?? start, end)
        : await findMissingDays(chainId, address, outputLabel, start, end)

      if (missing.length === 0 || missing[missing.length - 1] !== end) {
        missing.push(end)
      }

      for (const blockTime of missing) {
        const jobId = `timeseries-${chainId}-${address}-${outputLabel}-${blockTime}`
        await mq.add(mq.job.extract.timeseries, {
          abiPath, chainId, address, outputLabel, blockTime
        }, { jobId })
      }
    }
  }
}

// series_time is endOfDay(block_time) at write time (packages/ingest/load/index.ts).
// For tvl / tvl-c, a day counts as computed only when component=tvl has a non-null
// value: null USD from a price-service outage must re-enter the queue (abis/yearn/lib/tvl.ts).
// Real 0 (na / empty vault) stays computed. Other labels keep #462's "any row closes
// the day" rule so apy/pps cannot loop. The BETWEEN range keeps the prunable scan
// on idx_output_chain_address_label_series_time (index-only for non-tvl labels; the
// tvl path reads component/value off the heap, ~one row per day); NOT IN is safe
// because series_time is NOT NULL.
export async function findMissingDays(chainId: number, address: `0x${string}`, label: string, start: bigint, end: bigint): Promise<bigint[]> {
  const timeline = makeTimeline(start, end)
  return (await db.query(`
  SELECT t.day FROM unnest($4::bigint[]) AS t(day)
  WHERE t.day NOT IN (
    SELECT FLOOR(EXTRACT(EPOCH FROM series_time))::bigint
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = $3
      AND series_time BETWEEN to_timestamp($5::double precision) AND to_timestamp($6::double precision)
      AND (
        $3 NOT IN ('tvl', 'tvl-c')
        OR (component = 'tvl' AND value IS NOT NULL)
      )
  )
  ORDER BY t.day ASC`,
  [chainId, address, label, timeline.map(String), Number(start), Number(end)]))
    .rows.map(row => BigInt(row.day))
}
