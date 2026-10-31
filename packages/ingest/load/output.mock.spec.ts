import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, release, toUpsertSql, invalidateSparkline } = vi.hoisted(() => ({
  query: vi.fn<(statement: unknown, values?: unknown[]) => Promise<{ rows: unknown[] }>>(
    async () => ({ rows: [] })
  ),
  release: vi.fn(),
  toUpsertSql: vi.fn((_table: string, _pk: string, data: object) =>
    `INSERT output (${Object.keys(data).join(', ')})`
  ),
  invalidateSparkline: vi.fn()
}))

vi.mock('../db', () => ({
  default: { connect: async () => ({ query, release }) },
  firstRow: vi.fn(), getTravelledStrides: vi.fn(), toUpsertSql,
  upsertThingDefaults: vi.fn(), upsertSnapshotData: vi.fn(), invalidateSparkline
}))

import Load from './index'

const output = { chainId: 1, address: '0x0000000000000000000000000000000000000001', label: 'apr', value: 1, blockNumber: 1n, blockTime: 1n }
type NamedQuery = { name: string; text: string; values: unknown[] }

function namedWrites(): NamedQuery[] {
  return query.mock.calls.flatMap(([arg]) => {
    if (typeof arg === 'object' && arg !== null && 'name' in arg && 'text' in arg && 'values' in arg) {
      return [arg as NamedQuery]
    }
    return []
  })
}

describe('output queue compatibility', () => {
  beforeEach(() => {
    query.mockReset()
    query.mockImplementation(async () => ({ rows: [] }))
    release.mockClear()
    invalidateSparkline.mockClear()
    toUpsertSql.mockReset()
    toUpsertSql.mockImplementation((_table, _pk, data) => `INSERT output (${Object.keys(data).join(', ')})`)
  })

  it.each([output, { batch: [output] }])('persists current and queued legacy payloads', async payload => {
    await new Load().handlers.output(payload)

    expect(namedWrites()).toEqual([
      expect.objectContaining({
        name: expect.stringMatching(/^kong_output_[a-f0-9]{48}$/),
        text: expect.stringContaining('INSERT output'),
        values: expect.arrayContaining([1, output.address, 'apr'])
      })
    ])
    expect(query).toHaveBeenCalledWith('COMMIT')
    expect(invalidateSparkline).toHaveBeenCalledWith(1, output.address, 'apr', 1n)
  })

  it('reuses names for repeated SQL while preserving row order for duplicate keys', async () => {
    await new Load().handlers.output({ batch: [output, { ...output, blockNumber: 2n, value: 2 }] })

    const writes = namedWrites()
    expect(writes).toHaveLength(2)
    expect(writes[0].name).toBe(writes[1].name)
    expect(writes[0].values).toContain(1n)
    expect(writes[1].values).toContain(2n)
    expect(query.mock.calls.map(([arg]) => typeof arg === 'string' ? arg : 'write')).toEqual([
      'BEGIN', 'write', 'write', 'COMMIT'
    ])
  })

  it('uses distinct names for reordered SQL and different optional field shapes', async () => {
    toUpsertSql
      .mockReturnValueOnce('INSERT output (chain_id, address)')
      .mockReturnValueOnce('INSERT output (address, chain_id)')
    await new Load().handlers.output({ batch: [output, output] })
    const reorderedWrites = namedWrites()
    expect(reorderedWrites[0].name).not.toBe(reorderedWrites[1].name)

    query.mockClear()
    await new Load().handlers.output({ batch: [
      Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'value')),
      { ...output, value: null }
    ] })

    const shapeWrites = namedWrites()
    expect(shapeWrites[0].text).not.toContain('value')
    expect(shapeWrites[1].text).toContain('value')
    expect(shapeWrites[0].name).not.toBe(shapeWrites[1].name)
    expect(shapeWrites[0].values).not.toContain(null)
    expect(shapeWrites[1].values).toContain(null)
  })

  it('rolls back the transaction when an output write fails', async () => {
    query.mockImplementation(async statement => {
      if (typeof statement === 'object' && statement !== null && 'text' in statement) {
        throw new Error('write failed')
      }
      return { rows: [] }
    })

    await expect(new Load().handlers.output(output)).rejects.toThrow('write failed')

    expect(query.mock.calls.map(([arg]) => arg)).toEqual(['BEGIN', expect.objectContaining({ text: expect.any(String) }), 'ROLLBACK'])
    expect(release).toHaveBeenCalledOnce()
    expect(invalidateSparkline).not.toHaveBeenCalled()
  })
})
