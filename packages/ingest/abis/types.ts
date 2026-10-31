import { Processor } from 'lib/processor'
import { EvmLog } from 'lib/types'
import { Log } from 'viem'

export type HookType = 'event' | 'snapshot' | 'timeseries'

export interface HookOutputGroup {
  key: string
  labels: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process: (chainId: number, address: `0x${string}`, data: any, outputLabels: string[]) => Promise<any>
}

export interface HookModule {
  topics?: `0x${string}`[]
  outputLabel?: string
  /**
   * Hooks that declare the same output group can be enqueued together for one
   * observation. The processor must render only the requested labels from one
   * shared computation. `key` is descriptive; processor identity is also
   * checked before hooks are grouped.
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
