import { math, mq, multicall3 } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { getBlockNumber, getBlockTime, getDefaultStartBlockNumber } from 'lib/blocks'
import db from '../db'
import { requireHooks } from '../abis'
import { ResolveHooks } from '../abis/types'
import { endOfDay, findMissingTimestamps } from 'lib/dates'

export default class TimeseriesFanout {
  resolveHooks: ResolveHooks | undefined

  async fanout(data: { abi: AbiConfig, source: SourceConfig, replay?: boolean }) {
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

      // series_time is endOfDay(block_time) at write time
      // (packages/ingest/load/index.ts). Filtering on series_time within
      // [start, end] lets Timescale prune chunks; pairs with index
      // idx_output_chain_address_label_series_time for an index-only scan.
      // pg timestamptz parser (packages/ingest/db.ts) returns bigint seconds.
      const computed = (await db.query(`
      SELECT DISTINCT series_time
      FROM output
      WHERE chain_id = $1 AND address = $2 AND label = $3
        AND series_time >= to_timestamp($4)
        AND series_time <= to_timestamp($5)
      ORDER BY series_time ASC`,
      [chainId, address, outputLabel, Number(start), Number(end)]))
        .rows.map(row => row.series_time as bigint)

      const missing = findMissingTimestamps(start, end, computed)
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
