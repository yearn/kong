import { Processor } from 'lib/processor'
import { EvmLog } from 'lib/types'
import { Log } from 'viem'

export type HookType = 'event' | 'snapshot' | 'timeseries'

export interface HookModule {
  topics?: `0x${string}`[]
  outputLabel?: string
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
  process: (chainId: number, address: `0x${string}`, log: Log|EvmLog) => Promise<any|undefined>
}

export interface SnapshotHook extends Processor {
  process: (chainId: number, address: `0x${string}`, snapshot: any) => Promise<any|undefined>
}
