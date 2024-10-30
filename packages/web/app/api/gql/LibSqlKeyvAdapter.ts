// until https://github.com/apollographql/apollo-utils/issues/457 is resovled
// we need to use a custom adapter
// adapted from https://github.com/apollographql/apollo-utils/blob/main/packages/keyvAdapter/src/index.ts

import type {
  KeyValueCache,
} from '@apollo/utils.keyvaluecache'
import { Client, InValue } from '@libsql/client'

export class LibSqlKeyvAdapter<
  V = string
> implements KeyValueCache<V>
{
  private readonly client: Client

  constructor(client: Client) {
    this.client = client
    this.client.execute({
      sql: 'CREATE TABLE IF NOT EXISTS keyv(key VARCHAR(255) PRIMARY KEY, value TEXT)',
      args: []
    }).catch((error) => {
      console.warn('Error creating keyv table')
      console.error(error)
    })
  }

  async get(key: string): Promise<V | undefined> {
    try {
      const result = await this.client.execute({
        sql: 'SELECT value FROM keyv WHERE key = ?',
        args: [key]
      })
      return result.rows[0]?.value as V | undefined
    } catch (error) {
      console.warn('Error fetching cache key', key)
      console.error(error)
      return undefined
    }
  }

  async set(
    key: string,
    value: V
  ): Promise<void> {
    try {
      await this.client.execute({
        sql: 'INSERT OR REPLACE INTO keyv (key, value) VALUES (?, ?)',
        args: [key, value as InValue]
      })
    } catch (error) {
      console.warn('Error setting cache key', key)
      console.error(error)
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.client.execute({
        sql: 'DELETE FROM keyv WHERE key = ?',
        args: [key]
      })
      return result.rowsAffected > 0
    } catch (error) {
      console.warn('Error deleting cache key', key)
      console.error(error)
      return false
    }
  }

  async clear(): Promise<void> {
    try {
      await this.client.execute({ sql: 'DELETE FROM keyv', args: [] })
    } catch (error) {
      console.warn('Error clearing cache')
      console.error(error)
    }
  }
}
