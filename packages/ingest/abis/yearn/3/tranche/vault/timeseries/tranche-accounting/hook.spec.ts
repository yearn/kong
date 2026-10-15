import { expect } from 'chai'
import { types } from 'lib'
import { mainnet } from 'viem/chains'
import { afterAll, beforeAll } from 'vitest'
import db from '../../../../../../../db'
import { upsertBatch } from '../../../../../../../load'
import { addresses } from '../../../../../../../test-addresses'
import process_ from './hook'

const BLOCK_TIME = 1784864807n
const { a: TRANCHE, usdc: USDC, controller } = addresses.tranche

describe('abis/yearn/3/tranche/vault/timeseries/tranche-accounting/hook', function() {
  beforeAll(async function() {
    await upsertBatch([{
      chainId: mainnet.id, address: TRANCHE, label: 'tranche',
      defaults: { decimals: 6, asset: USDC, priority: 0, trancheController: controller }
    }] as types.Thing[], 'thing', 'chain_id, address, label')
  })

  afterAll(async function() {
    await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
      [mainnet.id, TRANCHE, 'tranche'])
  })

  it('emits controller accounting normalized to asset decimals', async function() {
    const outputs = await process_(mainnet.id, TRANCHE, {
      abiPath: 'yearn/3/tranche/vault', chainId: mainnet.id, address: TRANCHE,
      outputLabel: 'tranche-accounting', blockTime: BLOCK_TIME
    })

    expect(outputs.map(output => output.component)).to.deep.equal([
      'baselineAssets', 'pendingExcess', 'liveAssets', 'claim', 'covered',
      'coverageRatio', 'targetRatePerSecondWad', 'excessShareBps', 'accrualPaused'
    ])

    const component = (name: string) => outputs.find(output => output.component === name)?.value

    expect(component('baselineAssets')).to.be.closeTo(1000.000256, 1e-6)
    expect(component('pendingExcess')).to.equal(0)
    expect(component('liveAssets')).to.be.greaterThan(1000)
    expect(component('coverageRatio')).to.be.closeTo(1, 1e-6)
    expect(component('targetRatePerSecondWad')).to.equal(1584436925)
    expect(component('excessShareBps')).to.equal(0)
    expect(component('accrualPaused')).to.equal(0)
  })

  it('emits nothing for an address that is not a tranche thing', async function() {
    const outputs = await process_(mainnet.id, addresses.rando, {
      abiPath: 'yearn/3/tranche/vault', chainId: mainnet.id, address: addresses.rando,
      outputLabel: 'tranche-accounting', blockTime: BLOCK_TIME
    })

    expect(outputs).to.deep.equal([])
  })
})
