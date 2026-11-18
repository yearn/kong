import { z } from 'zod'
import { mq } from 'lib'
import { OutputSchema, zhexstring } from 'lib/types'
import { endOfDay, isClosedDay } from 'lib/dates'
import { ResolveHooks, sameOutputGroup } from '../abis/types'
import { requireHooks } from '../abis'

export const DataSchema = z.object({
  abiPath: z.string(),
  chainId: z.number(),
  address: zhexstring,
  outputLabel: z.string(),
  // Optional for new grouped jobs. Existing persisted jobs contain only
  // outputLabel and continue through the original single-hook path.
  outputLabels: z.array(z.string()).optional(),
  blockTime: z.bigint({ coerce: true }),
  // Optional for persisted jobs created before requested-day coverage was
  // carried separately. Those jobs already have the requested day in blockTime.
  seriesTime: z.bigint({ coerce: true }).optional(),
  // Derived once per extraction so a job crossing midnight keeps the same
  // historical/open-day decision through its hook and load payload.
  isClosedDay: z.boolean().optional()
})

export type Data = z.infer<typeof DataSchema>

export class TimeseriesExtractor {
  resolveHooks: ResolveHooks | undefined

  async extract(data: Data) {
    data = DataSchema.parse(data)
    const seriesTime = data.seriesTime ?? data.blockTime
    const isClosedSeriesDay = isClosedDay(seriesTime)
    data = { ...data, seriesTime, isClosedDay: isClosedSeriesDay }
    const { abiPath, chainId, address, outputLabel } = data
    if (!this.resolveHooks) this.resolveHooks = await requireHooks()

    const hooks = this.resolveHooks(abiPath, 'timeseries')
    const hook = hooks.find(hook => hook.module.outputLabel === outputLabel)
    if (!hook) throw new Error(`!hook, ${outputLabel}`)

    let result
    if (data.outputLabels) {
      if (data.outputLabels.length === 0 || !data.outputLabels.includes(outputLabel)) {
        throw new Error(`invalid grouped outputLabels for ${outputLabel}`)
      }

      const groupedHooks = data.outputLabels.map(label => {
        const groupedHook = hooks.find(candidate => candidate.module.outputLabel === label)
        if (!groupedHook) throw new Error(`!hook, ${label}`)
        const group = groupedHook.module.outputGroup
        if (!group || !group.labels.includes(label)) {
          throw new Error(`!compatible output group, ${label}`)
        }
        return { hook: groupedHook, group }
      })
      const firstGroup = groupedHooks[0].group
      if (groupedHooks.some(({ group }) => !sameOutputGroup(group, firstGroup))) {
        throw new Error(`incompatible output group for ${data.outputLabels.join(', ')}`)
      }

      result = await firstGroup.process(chainId, address, data, data.outputLabels)
    } else {
      result = await hook.module.default(chainId, address, data)
    }

    const outputs = OutputSchema.array().parse(result).map(output => {
      // A few historical readers may resolve a stalled chain to an older
      // actual block. Keep that blockTime intact while assigning the row to
      // the requested coverage day. The hook path allowlist and closed-day
      // guard keep this away from unrelated outputs and the live day.
      if (
        isClosedSeriesDay
        && usesRequestedSeriesDay(abiPath, output.label)
        && endOfDay(seriesTime) >= output.blockTime
      ) return { ...output, seriesTime }

      return output
    })
    if (data.outputLabels) {
      const requested = data.outputLabels
      if (outputs.some(output => !requested.includes(output.label) || output.blockTime !== data.blockTime)) {
        throw new Error(`grouped processor returned outputs outside the request for ${requested.join(', ')}`)
      }
    }

    if (outputs.length === 0) return
    await mq.add(mq.job.load.output, { batch: outputs })
  }
}

const requestedSeriesDayOutputs: Record<string, Set<string>> = {
  erc4626: new Set(['apy-bwd-delta-pps', 'pps']),
  'yearn/2/vault': new Set(['apy-bwd-delta-pps', 'pps']),
  'yearn/3/vault': new Set(['apy-bwd-delta-pps', 'pps']),
  'yearn/3/tranche/vault': new Set(['apy-bwd-delta-pps', 'pps', 'tranche-accounting']),
  'yearn/3/tranche/controller': new Set(['tranche-system'])
}

function usesRequestedSeriesDay(abiPath: string, outputLabel: string) {
  return requestedSeriesDayOutputs[abiPath]?.has(outputLabel) ?? false
}
