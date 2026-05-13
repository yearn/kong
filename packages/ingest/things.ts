import { query, some } from './db'
import { ThingsConfig } from 'lib/abis'
import { Thing, ThingSchema } from 'lib/types'
import { CompareOperator, compare } from 'compare-versions'
import { clean } from 'lib/version'

export const semver = /^(\d+)\.(\d+)\.(\d+)$/

export async function get(config: ThingsConfig): Promise<Thing[]> {
  const params: string[] = [config.label]
  const filters = ['label = $1']
  const semverFilters = config.filter.filter(filter => semver.test(filter.value))

  for (const filter of config.filter) {
    if (semver.test(filter.value)) continue

    params.push(filter.field, filter.value)
    const fieldParam = `$${params.length - 1}`
    const valueParam = `$${params.length}`

    if (filter.op === '=') {
      filters.push(`defaults->>${fieldParam} = ${valueParam}`)
    } else if (filter.op === '!=') {
      filters.push(`defaults->>${fieldParam} IS DISTINCT FROM ${valueParam}`)
    } else {
      throw new Error('not implemented')
    }
  }

  const allthings = await query<Thing>(ThingSchema, `SELECT * FROM thing WHERE ${filters.join(' AND ')}`, params)
  if(semverFilters.length === 0) return allthings
  return allthings.filter(thing => {
    for (const filter of semverFilters) {
      const field = thing.defaults[filter.field]
      if (!(field && compare(clean(field), filter.value, (filter.op as CompareOperator)))) return false
    }
    return true
  })
}

export async function exist(chainId: number, address: `0x${string}`, label: string) {
  return await some('SELECT 1 FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3', [chainId, address, label])
}
