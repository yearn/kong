import { expect } from 'chai'
import { add, contains, plan, remove } from './strider'

describe.only('strider', function() {
  it('plans new strides', async function() {
    expect(plan(0n, 100n, undefined)).to.deep.equal([{ from: 0n, to: 100n }])
    expect(plan(0n, 100n, [])).to.deep.equal([{ from: 0n, to: 100n }])
  })

  it('plans around previous strides', async function() {
    expect(plan(0n, 100n, [{ from: 0n, to: 50n }]))
      .to.deep.equal([{ from: 51n, to: 100n }])

    expect(plan(0n, 100n, [{ from: 50n, to: 100n }]))
      .to.deep.equal([{ from: 0n, to: 49n }])

    expect(plan(0n, 100n, [{ from: 10n, to: 20n }, { from: 70n, to: 90n }]))
      .to.deep.equal([{ from: 0n, to: 9n }, { from: 21n, to: 69n }, { from: 91n, to: 100n }])

    expect(plan(0n, 100n, [{ from: 10n, to: 20n }, { from: 70n, to: 90n }, { from: 200n, to: 300n }]))
      .to.deep.equal([{ from: 0n, to: 9n }, { from: 21n, to: 69n }, { from: 91n, to: 100n }])
  })

  it('adds strides', async function() {
    expect(add({ from: 0n, to: 100n },    [])).to.deep.equal([{ from: 0n, to: 100n }])
    expect(add({ from: 0n, to: 100n },    [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 100n }])
    expect(add({ from: 50n, to: 100n },   [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 100n }])
    expect(add({ from: 50n, to: 150n },   [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 150n }])
    expect(add({ from: 200n, to: 300n },  [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 100n }, { from: 200n, to: 300n }])
    expect(add({ from: 100n, to: 200n },  [{ from: 0n, to: 100n }, { from: 200n, to: 300n }])).to.deep.equal([{ from: 0n, to: 300n }])
    expect(add({ from: 101n, to: 199n },  [{ from: 0n, to: 100n }, { from: 200n, to: 300n }])).to.deep.equal([{ from: 0n, to: 300n }])
    expect(add({ from: 100n, to: 199n },  [{ from: 200n, to: 300n }])).to.deep.equal([{ from: 100n, to: 300n }])
  })

  it('removes strides', async function() {
    expect(remove({ from: 0n, to: 100n }, [])).to.deep.equal([])
    expect(remove({ from: 0n, to: 100n }, [{ from: 0n, to: 100n }])).to.deep.equal([])
    expect(remove({ from: 10n, to: 20n }, [{ from: 0n, to: 5n }, { from: 25n, to: 30n }])).to.deep.equal([{ from: 0n, to: 5n }, { from: 25n, to: 30n }])
    expect(remove({ from: 0n, to: 50n }, [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 51n, to: 100n }])
    expect(remove({ from: 50n, to: 100n }, [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 49n }])
    expect(remove({ from: 30n, to: 40n }, [{ from: 0n, to: 100n }])).to.deep.equal([{ from: 0n, to: 29n }, { from: 41n, to: 100n }])
  })


  it('knows when strides contain strides', async function() {
    expect(contains({ from: 0n, to: 10n }, { from: 0n, to: 10n })).to.be.true
    expect(contains({ from: 0n, to: 10n }, { from: 2n, to: 9n })).to.be.true
    expect(contains({ from: 0n, to: 10n }, { from: 11n, to: 12n })).to.be.false
    expect(contains({ from: 0n, to: 10n }, { from: 0n, to: 12n })).to.be.false
  })
})
