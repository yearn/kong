import { math, mq, multicall3 } from 'lib'
import { AbiConfig, AbiConfigSchema, SourceConfig, SourceConfigSchema } from 'lib/abis'
import { getBlockNumber, getBlockTime, getDefaultStartBlockNumber } from 'lib/blocks'
import db from '../db'
import { requireHooks } from '../abis'
import { HookOutputGroup, ResolveHooks, sameOutputGroup } from '../abis/types'
import { endOfDay, makeTimeline } from 'lib/dates'

const groupedTvlJobsEnabled = () => process.env.TVL_GROUPED_JOBS === 'true'

export default class TimeseriesFanout {
  resolveHooks: ResolveHooks | undefined

  async fanout(data: { abi: AbiConfig, source: SourceConfig, replay?: { enabled: boolean, since?: bigint } }) {
    if (!this.resolveHooks) this.resolveHooks = await requireHooks()
    const { chainId, address, inceptBlock, startBlock, endBlock } = SourceConfigSchema.parse(data.source)
    const { abiPath } = AbiConfigSchema.parse(data.abi)
    const multicall3Activation = multicall3.getActivation(chainId)
    const defaultStartBlockNumber = await getDefaultStartBlockNumber(chainId)

    const hooks = this.resolveHooks(abiPath, 'timeseries')
    if (hooks.length === 0) return
    const from = startBlock !== undefined
      ? startBlock
      : math.max(inceptBlock, defaultStartBlockNumber, multicall3Activation)
    const to = endBlock !== undefined ? endBlock : await getBlockNumber(chainId)
    const start = endOfDay(await getBlockTime(chainId, from))
    const end = endOfDay(await getBlockTime(chainId, to))

    const labelledHooks = hooks.map(hook => {
      const outputLabel = hook.module.outputLabel
      if (!outputLabel) throw new Error(`!outputLabel, ${abiPath} timeseries hook`)
      return { hook, outputLabel }
    })

    // Grouping is opt-in because old extract workers ignore the optional
    // outputLabels field. Keep the worker rollout safe: upgrade every consumer,
    // then enable TVL_GROUPED_JOBS on fanout workers.
    const groups: (HookOutputGroup & { hooks: typeof labelledHooks })[] = []
    const standalone: typeof labelledHooks = []
    for (const item of labelledHooks) {
      const group = item.hook.module.outputGroup
      if (!groupedTvlJobsEnabled() || !group) {
        standalone.push(item)
        continue
      }

      if (!group.labels.includes(item.outputLabel)) {
        throw new Error(`outputLabel ${item.outputLabel} is not declared by output group ${group.key}`)
      }

      const match = groups.find(candidate => sameOutputGroup(candidate, group))
      if (match) match.hooks.push(item)
      else groups.push({ ...group, hooks: [item] })
    }

    const standaloneMissing = await Promise.all(
      standalone.map(item => missingDays(chainId, address, item.outputLabel, start, end, data.replay))
    )
    for (const [index, item] of standalone.entries()) {
      for (const blockTime of standaloneMissing[index]) {
        await enqueueTimeseries(abiPath, chainId, address, item.outputLabel, blockTime)
      }
    }

    for (const group of groups) {
      // Coverage remains label-specific. A day is included only with labels that
      // independently need that observation; this preserves partial completion.
      const requestedByDay = new Map<string, { blockTime: bigint, outputLabels: string[] }>()
      const groupMissing = await Promise.all(
        group.hooks.map(({ outputLabel }) => missingDays(chainId, address, outputLabel, start, end, data.replay))
      )
      for (const [index, { outputLabel }] of group.hooks.entries()) {
        for (const blockTime of groupMissing[index]) {
          const key = blockTime.toString()
          const observation = requestedByDay.get(key) ?? { blockTime, outputLabels: [] }
          observation.outputLabels.push(outputLabel)
          requestedByDay.set(key, observation)
        }
      }

      for (const { blockTime, outputLabels } of requestedByDay.values()) {
        await enqueueGroupedTimeseries(abiPath, chainId, address, group.key, outputLabels, blockTime)
      }
    }
  }
}

async function missingDays(
  chainId: number,
  address: `0x${string}`,
  outputLabel: string,
  start: bigint,
  end: bigint,
  replay?: { enabled: boolean, since?: bigint }
) {
  // Replay is the only path back for days the anti-join counts as computed but
  // hold a null value (abis/yearn/lib/tvl.ts).
  const missing = replay?.enabled
    ? makeTimeline(replay.since ?? start, end)
    : await findMissingDays(chainId, address, outputLabel, start, end)

  if (missing.length === 0 || missing[missing.length - 1] !== end) missing.push(end)
  return missing
}

async function enqueueTimeseries(abiPath: string, chainId: number, address: `0x${string}`, outputLabel: string, blockTime: bigint) {
  const jobId = `timeseries-${chainId}-${address}-${outputLabel}-${blockTime}`
  await mq.add(mq.job.extract.timeseries, {
    abiPath, chainId, address, outputLabel, blockTime
  }, { jobId })
}

async function enqueueGroupedTimeseries(abiPath: string, chainId: number, address: `0x${string}`, groupKey: string, outputLabels: string[], blockTime: bigint) {
  const labels = [...new Set(outputLabels)].sort()
  const labelKey = labels.map(encodeURIComponent).join('_')
  const jobId = `timeseries-${chainId}-${address}-group-${encodeURIComponent(groupKey)}-${labelKey}-${blockTime}`
  await mq.add(mq.job.extract.timeseries, {
    abiPath, chainId, address, outputLabel: labels[0], outputLabels: labels, blockTime
  }, { jobId })
}

// series_time is endOfDay(block_time) at write time (packages/ingest/load/index.ts).
// The anti-join returns only the missing days, not every computed day — the full
// computed list was ~50M calls x O(history) rows of egress per fanout cycle. The
// BETWEEN range keeps the single prunable index-only scan on
// idx_output_chain_address_label_series_time; NOT IN is safe because series_time
// is NOT NULL.
export async function findMissingDays(chainId: number, address: `0x${string}`, label: string, start: bigint, end: bigint): Promise<bigint[]> {
  const timeline = makeTimeline(start, end)
  return (await db.query(`
  SELECT t.day FROM unnest($4::bigint[]) AS t(day)
  WHERE t.day NOT IN (
    SELECT FLOOR(EXTRACT(EPOCH FROM series_time))::bigint
    FROM output
    WHERE chain_id = $1 AND address = $2 AND label = $3
      AND series_time BETWEEN to_timestamp($5::double precision) AND to_timestamp($6::double precision)
  )
  ORDER BY t.day ASC`,
  [chainId, address, label, timeline.map(String), Number(start), Number(end)]))
    .rows.map(row => BigInt(row.day))
}
