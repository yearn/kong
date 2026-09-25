import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'
import { buildSchema, graphql, print, type GraphQLObjectType } from 'graphql'
const { query } = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/app/api/db', () => ({ default: { query } }))
import allocator from './allocator'
import vault from './vault'
import allocatorTypeDefs from '../typeDefs/allocator'
import { mergeSnapshot, mergedFieldSql } from '@/lib/mergeSnapshot'

const address = '0xbe53a109b494e5c9f97b9cd39fe969be68bf6204'
const schema = buildSchema(`${print(allocatorTypeDefs)}
type Query { allocator(chainId:Int!,vault:String!):Allocator }`)
const assigned = '0x1e9eB053228B1156831759401dE0E115356b8671'

beforeEach(() => query.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('snapshot-backed allocator GraphQL queries', () => {
  it.each([assigned, null, undefined])('agrees with vault and REST snapshot fields: %s', async selected => {
    const hook = { allocator: selected }
    const rest = mergeSnapshot({}, {}, hook)
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(params).toEqual(expect.arrayContaining([1, getAddress(address)]))
      expect(sql).not.toContain('evmlog')
      expect(sql).not.toContain('allocatorState')
      return { rows: [sql.includes(' AS allocator')
        ? { allocator: selected ?? null }
        : { chain_id: 1, address: getAddress(address), merged: rest }] }
    })
    const [a, v] = await Promise.all([allocator({}, { chainId: 1, vault: address }), vault({}, { chainId: 1, address })])
    expect(a).toEqual(selected == null ? null : { chainId: 1, vault: getAddress(address), address: selected })
    expect(a?.address ?? null).toBe(v.allocator ?? null)
    expect(query.mock.calls[0][0]).toContain(`${mergedFieldSql('allocator')} AS allocator`)
    expect(query.mock.calls[0][0]).not.toContain(' AS merged')
    const result = await graphql({
      schema, source: 'query($vault:String!){allocator(chainId:1,vault:$vault){chainId vault address}}',
      variableValues: { vault: address },
      rootValue: { allocator: (args: Parameters<typeof allocator>[1]) => allocator({}, args) }
    })
    expect(result.errors).toBeUndefined()
    expect(result.data?.allocator).toEqual(a)
  })
  it('preserves the non-null address schema contract', () => {
    expect(String((schema.getType('Allocator') as GraphQLObjectType).getFields().address.type)).toBe('String!')
  })
  it('returns null for a vault with no stored snapshot', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await allocator({}, { chainId: 1, vault: address })).toBeNull()
  })
  it.each(['invalid', address])('masks resolver errors for %s', async input => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValue(new Error('private database details'))
    const result = await graphql({
      schema: buildSchema('type Query { allocator(chainId:Int!,vault:String!):String }'),
      source: 'query($vault:String!){allocator(chainId:1,vault:$vault)}', variableValues: { vault: input },
      rootValue: { allocator: (args: Parameters<typeof allocator>[1]) => allocator({}, args) }
    })
    expect(result.errors?.map(error => error.message)).toEqual(['!vaults'])
    expect(log).toHaveBeenCalledOnce()
    if (input === 'invalid') expect(query).not.toHaveBeenCalled()
  })
})
