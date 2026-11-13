import {
  calculateAggregateTvl,
  getAggregateTvlStrategyRefs,
} from '../../../web/app/api/rest/tvl/aggregate'
import type { AggregateTvlSummary } from '../../../web/app/api/rest/tvl/redis'
import { AGGREGATE_TVL_KEY, AGGREGATE_TVL_SUMMARY_KEY } from '../../../web/app/api/rest/tvl/redis'
import { getAggregateStrategies, getAggregateVaults } from '../../../web/app/api/rest/tvl/db'
import type { JobContext } from '../job-types'
import { stringifyCacheValue } from './json'

export async function refreshTvl({ sourceDb, cache, now }: JobContext): Promise<void> {
  const vaults = await getAggregateVaults(sourceDb)
  const strategyRefs = getAggregateTvlStrategyRefs(vaults)
  const strategies = await getAggregateStrategies(strategyRefs, sourceDb)
  const payload = calculateAggregateTvl(vaults, strategies, now ?? new Date())
  const summary: AggregateTvlSummary = {
    updatedAt: payload.updatedAt,
    unpricedVaults: payload.unpricedVaults,
    chains: payload.chains.map(({ chainId, tvl, unpricedVaults }) => ({ chainId, tvl, unpricedVaults })),
  }

  await cache.setMany([
    [AGGREGATE_TVL_KEY, stringifyCacheValue({ value: payload })],
    [AGGREGATE_TVL_SUMMARY_KEY, stringifyCacheValue({ value: summary })],
  ], { atomic: true })
}
