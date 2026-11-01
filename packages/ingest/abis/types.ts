import type { Processor } from 'lib/processor'
import type { EvmLog, Output } from 'lib/types'
import type { Log } from 'viem'
import type { Data } from '../extract/timeseries'

export type HookType = 'event' | 'snapshot' | 'timeseries'

export interface HookOutputGroup {
  key: string
  labels: string[]
  process: (chainId: number, address: `0x${string}`, data: Data, outputLabels: string[]) => Promise<Output[]>
}

export function sameOutputGroup(left: HookOutputGroup, right: HookOutputGroup) {
  return left.key === right.key &&
    left.process === right.process &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index])
}

export interface HookModule {
  topics?: `0x${string}`[]
  outputLabel?: string
  /**
   * Hooks that declare the same output group can be enqueued together for one
   * observation. The processor must render only the requested labels from one
   * shared computation. Grouping (fanout) and compatibility (extract) require
   * `key`, `process` identity and the ordered `labels` to all match.
   */
  outputGroup?: HookOutputGroup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (chainId: number, address: `0x${string}`, data: any) => Promise<any>
}

export interface AbiHook {
  type: HookType
  abiPath: string
  module: HookModule
}

export interface ResolveHooks {
  (path: string, type?: HookType): AbiHook[]
}

export interface EventHook extends Processor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process: (chainId: number, address: `0x${string}`, log: Log|EvmLog) => Promise<any|undefined>
}

export interface SnapshotHook extends Processor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process: (chainId: number, address: `0x${string}`, snapshot: any) => Promise<any|undefined>
}
