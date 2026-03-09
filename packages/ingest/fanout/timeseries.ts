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

      const computed = (await db.query(`
      SELECT DISTINCT block_time
      FROM output
      WHERE chain_id = $1 AND address = $2 AND label = $3
      ORDER BY block_time ASC`,
      [chainId, address, outputLabel]))
        .rows.map(row => BigInt(row.block_time))

      const missing = findMissingTimestamps(start, end, computed)
      if (missing.length === 0 || missing[missing.length - 1] !== end) {
        missing.push(end)
      }

      for (const blockTime of missing) {
        await mq.add(mq.job.extract.timeseries, {
          abiPath, chainId, address, outputLabel, blockTime
        })
      }
    }
  }
}
