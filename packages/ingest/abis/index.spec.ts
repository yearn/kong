import { expect } from 'chai'
import path from 'path'
import fs from 'fs/promises'
import { getHookType, isHookPath, parseHookPath, requireHooks } from '.'

describe('abis', function() {
  describe('hook resolver', function() {
    this.timeout(10_000)  // hook resolver is kinda slow rn
    const root = path.join(__dirname, '.spec')

    beforeEach(async function() {
      await fs.mkdir(root, { recursive: true })
      await fs.mkdir(path.join(root, 'event/n'), { recursive: true })
      await fs.writeFile(path.join(root, 'event/n/hook.ts'), '')
      await fs.mkdir(path.join(root, 'x/y/event/n'), { recursive: true })
      await fs.writeFile(path.join(root, 'x/y/event/n/hook.ts'), '')
      await fs.mkdir(path.join(root, 'x/y/z/event/n'), { recursive: true })
      await fs.writeFile(path.join(root, 'x/y/z/event/n/hook.ts'), '')
      await fs.mkdir(path.join(root, 'x/y/z/snapshot'), { recursive: true })
      await fs.writeFile(path.join(root, 'x/y/z/snapshot/hook.ts'), '')
      await fs.mkdir(path.join(root, 'x/y/z2/event/n'), { recursive: true })
      await fs.writeFile(path.join(root, 'x/y/z2/event/n/hook.ts'), '')
      await fs.mkdir(path.join(root, 'x/j/k/event/n'), { recursive: true })
      await fs.writeFile(path.join(root, 'x/j/k/event/n/hook.ts'), '')
      await fs.mkdir(path.join(root, 'a/b/event'), { recursive: true })
      await fs.writeFile(path.join(root, 'a/b/event/hook.ts'), '')
      await fs.mkdir(path.join(root, 'a/b/timeseries/tvl'), { recursive: true })
      await fs.writeFile(path.join(root, 'a/b/timeseries/tvl/hook.ts'), '')
      await fs.mkdir(path.join(root, 'a/b/timeseries/apy'), { recursive: true })
      await fs.writeFile(path.join(root, 'a/b/timeseries/apy/hook.ts'), '')
    })

    afterEach(async function() {
      await fs.rm(root, { recursive: true })
    })

    it('knows hook from not hook', function() {
      expect(isHookPath(path.join(root, 'a/b/event/hook.ts'))).to.be.true
      expect(isHookPath(path.join(root, 'a/b/snapshot/hook.ts'))).to.be.true
      expect(isHookPath(path.join(root, 'a/b/timeseries/hook.ts'))).to.be.true
      expect(isHookPath(path.join(root, 'a/b/nihao/hook.ts'))).to.be.false
    })

    it('gets types', function() {
      expect(getHookType(path.join(root, 'a/b/event/hook.ts'))).to.equal('event')
      expect(getHookType(path.join(root, 'a/b/snapshot/hook.ts'))).to.equal('snapshot')
      expect(getHookType(path.join(root, 'a/b/timeseries/hook.ts'))).to.equal('timeseries')
      expect(getHookType(path.join(root, 'a/b/nihao/hook.ts'))).to.be.undefined
    })

    it('parses paths', function() {
      expect(parseHookPath(path.join(root, 'a/b/event/hook.ts'), root)).to.deep.equal({ type: 'event', abiPath: 'a/b' })
      expect(parseHookPath(path.join(root, 'a/b/snapshot/hook.ts'), root)).to.deep.equal({ type: 'snapshot', abiPath: 'a/b' })
      expect(parseHookPath(path.join(root, 'a/b/timeseries/hook.ts'), root)).to.deep.equal({ type: 'timeseries', abiPath: 'a/b' })
    })

    it('resolves paths', async function() {
      const resolveHooks = await requireHooks(root)
      expect(resolveHooks('')).to.have.length(9)
      expect(resolveHooks('', 'event')).to.have.length(6)
      expect(resolveHooks('', 'snapshot')).to.have.length(1)
      expect(resolveHooks('', 'timeseries')).to.have.length(2)

      expect(resolveHooks('x')).to.have.length(6)
      expect(resolveHooks('x', 'event')).to.have.length(5)
      expect(resolveHooks('x', 'snapshot')).to.have.length(1)
      expect(resolveHooks('x', 'timeseries')).to.have.length(0)

      expect(resolveHooks('x/y/z')).to.have.length(4)
      expect(resolveHooks('x/y/z', 'event')).to.have.length(3)
      expect(resolveHooks('x/y/z', 'snapshot')).to.have.length(1)
      expect(resolveHooks('x/y/z', 'timeseries')).to.have.length(0)

      expect(resolveHooks('x/y/z2')).to.have.length(3)
      expect(resolveHooks('x/y/z2', 'event')).to.have.length(3)
      expect(resolveHooks('x/y/z2', 'snapshot')).to.have.length(0)
      expect(resolveHooks('x/y/z2', 'timeseries')).to.have.length(0)

      expect(resolveHooks('x/j/k')).to.have.length(2)
      expect(resolveHooks('x/j/k', 'event')).to.have.length(2)
      expect(resolveHooks('x/j/k', 'snapshot')).to.have.length(0)
      expect(resolveHooks('x/j/k', 'timeseries')).to.have.length(0)

      expect(resolveHooks('a/b')).to.have.length(4)
      expect(resolveHooks('a/b', 'event')).to.have.length(2)
      expect(resolveHooks('a/b', 'snapshot')).to.have.length(0)
      expect(resolveHooks('a/b', 'timeseries')).to.have.length(2)
    })
  })
})
