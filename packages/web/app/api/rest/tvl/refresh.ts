import { cronDb } from '../../db/cron'
import type { Pool } from 'pg'
import { cacheMSet, serializeState } from '../cache'
import { restHistoryStart } from '../history'
import {
  calculateAggregateTvl,
  getAggregateTvlStrategyRefs,
} from './aggregate'
import type { AggregateTvlPayload } from './aggregate'
import { getAggregateStrategies, getAggregateVaults } from './db'
import { AGGREGATE_TVL_KEY, AGGREGATE_TVL_SUMMARY_KEY, type AggregateTvlSummary } from './redis'

export type { AggregateTvlPayload } from './aggregate'
export { AGGREGATE_TVL_KEY } from './redis'

export async function getCurrentAggregate(pool: Pool) {
  const vaults = await getAggregateVaults(pool)
  const strategies = await getAggregateStrategies(getAggregateTvlStrategyRefs(vaults), pool)
  const payload: AggregateTvlPayload = calculateAggregateTvl(vaults, strategies, new Date())
  const summary: AggregateTvlSummary = {
    updatedAt: payload.updatedAt,
    unpricedVaults: payload.unpricedVaults,
    chains: payload.chains.map(({ chainId, tvl, unpricedVaults }) => ({ chainId, tvl, unpricedVaults })),
  }
  return { payload, summary }
}

/** Refresh the cached approximate aggregate from the latest available snapshots. */
export async function refresh(): Promise<void> {
  const started = Date.now()

  try {
    const cutoff = restHistoryStart(started / 1000)
    const { payload, summary } = await getCurrentAggregate(cronDb)
    // Publish both views together, even when they exceed the normal chunk target.
    // Oversized writes fail before publishing either key.
    await cacheMSet([
      [AGGREGATE_TVL_KEY, serializeState(payload, cutoff)],
      [AGGREGATE_TVL_SUMMARY_KEY, serializeState(summary, cutoff)],
    ], { atomic: true })
    console.log(
      `✓ Refreshed aggregate TVL: ${payload.tvl} across ${payload.chains.length} chains ` +
      `(${payload.vaults.length} vaults, ${payload.unpricedVaults} unpriced)`,
    )
  } finally {
    console.log(`refresh aggregate tvl: ${Date.now() - started}ms`)
  }
}
