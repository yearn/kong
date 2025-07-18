// until https://github.com/apollographql/apollo-utils/issues/457 is resovled we need to use a custom adapter
// adapted from https://github.com/apollographql/apollo-utils/blob/main/packages/keyvAdapter/src/index.ts

import type {
  KeyValueCache,
  KeyValueCacheSetOptions,
} from '@apollo/utils.keyvaluecache'
import Keyv from 'keyv'
import DataLoader from 'dataloader'

interface KeyvAdapterOptions {
  disableBatchReads?: boolean
}

export class CustomKeyvAdapter<
  V = string
> implements KeyValueCache<V>
{
  private readonly keyv: Keyv
  private readonly dataLoader: DataLoader<string, V | undefined> | undefined

  constructor(keyv?: Keyv, options?: KeyvAdapterOptions) {
    this.keyv = keyv ?? new Keyv()
    this.dataLoader = options?.disableBatchReads
      ? undefined
      : new DataLoader(
        async (keys) => {
          const result = await this.keyv.get([...keys])
          if (!result) {
            return [...Array(keys.length)]
          }
          return result
        },
        // We're not actually using `DataLoader` for its caching
        // capabilities, we're only interested in batching functionality
        { cache: false },
      )
  }

  async get(key: string): Promise<V | undefined> {
    return this.dataLoader ? this.dataLoader.load(key) : this.keyv.get(key)
  }

  async set(
    key: string,
    value: V,
    opts?: KeyValueCacheSetOptions,
  ): Promise<void> {
    // Maybe an unnecessary precaution, just being careful with 0 here. Keyv
    // currently handles 0 as `undefined`. Also `NaN` is typeof `number`
    if (typeof opts?.ttl === 'number' && !Number.isNaN(opts.ttl)) {
      await this.keyv.set(key, value, opts.ttl * 1000)
    } else {
      await this.keyv.set(key, value)
    }
  }

  async delete(key: string): Promise<boolean> {
    return this.keyv.delete(key)
  }
}
