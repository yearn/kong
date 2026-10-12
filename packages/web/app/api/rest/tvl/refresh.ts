import { cronDb } from '../../db/cron'
import { cacheMSet } from '../cache'
import {
  calculateAggregateTvl,
  getAggregateTvlStrategyRefs,
} from './aggregate'
import type { AggregateTvlPayload } from './aggregate'
import { getAggregateStrategies, getAggregateVaults } from './db'
import { AGGREGATE_TVL_KEY } from './redis'

export type { AggregateTvlPayload } from './aggregate'
export { AGGREGATE_TVL_KEY } from './redis'

/** Refresh the cached approximate aggregate from the latest available snapshots. */
export async function refresh(): Promise<void> {
  const started = Date.now()

  try {
    const vaults = await getAggregateVaults(cronDb)
    const strategyRefs = getAggregateTvlStrategyRefs(vaults)
    const strategies = await getAggregateStrategies(strategyRefs, cronDb)
    const payload: AggregateTvlPayload = calculateAggregateTvl(vaults, strategies, new Date())

    // One Redis MSET publishes the complete payload. This write helper
    // propagates Redis errors, so a failed refresh leaves the old key intact.
    await cacheMSet([[AGGREGATE_TVL_KEY, JSON.stringify({ value: payload })]])
    console.log(
      `✓ Refreshed aggregate TVL: ${payload.tvl} across ${payload.chains.length} chains ` +
      `(${payload.vaults.length} vaults)`,
    )
  } finally {
    console.log(`refresh aggregate tvl: ${Date.now() - started}ms`)
  }
}
