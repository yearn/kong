import { describe, expect, it } from 'vitest'
import { AbiConfig, AbiConfigSchema, prune } from './abis'

describe('abis', function() {
  it('prunes nothing', async function() {
    const abis: AbiConfig[] = mock()
    expect(prune(abis)).to.deep.equal(abis)
  })

  it('prunes abis', async function() {
    const abis = mock()
    abis[0].skip = true
    expect(prune(abis)).to.deep.equal(abis.slice(1))

    abis[0].skip = false
    abis[0].only = true
    expect(prune(abis)).to.deep.equal([{...abis[0], skip: false, only: true}])
  })

  it('prunes sources', async function() {
    const abis = mock()
    abis[0].sources[0].skip = true
    let pruned = prune(abis)
    expect(pruned.length).to.equal(3)
    expect(pruned[0].sources.length).to.equal(1)

    abis[0].sources[0].skip = false
    abis[0].sources[0].only = true
    pruned = prune(abis)
    expect(pruned.length).to.equal(1)
    expect(pruned[0].sources.length).to.equal(1)
    expect(pruned[0].abiPath).to.equal('a')
  })

  it('prunes things', async function() {
    const abis = mock()
    abis[2].things!.skip = true
    let pruned = prune(abis)
    expect(pruned).to.deep.equal(abis.slice(0, 2))

    abis[2].things!.skip = false
    abis[2].things!.only = true
    pruned = prune(abis)
    expect(pruned.length).to.equal(1)
    expect(pruned[0].sources.length).to.equal(0)
    expect(pruned[0].abiPath).to.equal('c')
    expect(pruned[0].things?.label).to.equal('c')
  })

  it('prunes contracts and sources', async function() {
    const abis = mock()
    abis[0].sources[0].only = true
    abis[1].only = true
    const pruned = prune(abis)
    expect(pruned.length).to.equal(2)
  })
})

function mock() {
  return AbiConfigSchema.array().parse([
    {
      abiPath: 'a', schedule: 'a',
      sources: [
        { chainId: 1, address: '0x', inceptBlock: 1n },
        { chainId: 2, address: '0x', inceptBlock: 1n }
      ],
      things: undefined
    },
    {
      abiPath: 'b', schedule: 'b',
      sources: [
        { chainId: 1, address: '0x', inceptBlock: 1n }
      ],
      things: undefined
    },
    {
      abiPath: 'c', schedule: 'c',
      sources: [],
      things: { label: 'c', filter: [] }
    }
  ])
}
