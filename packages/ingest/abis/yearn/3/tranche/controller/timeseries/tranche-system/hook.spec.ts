import { expect } from 'chai'
import { types } from 'lib'
import { mainnet } from 'viem/chains'
import { afterAll, beforeAll } from 'vitest'
import db from '../../../../../../../db'
import { upsertBatch } from '../../../../../../../load'
import { addresses } from '../../../../../../../test-addresses'
import process_ from './hook'

const BLOCK_TIME = 1784864807n
const { controller, usdc: USDC } = addresses.tranche

describe('abis/yearn/3/tranche/controller/timeseries/tranche-system/hook', function() {
  beforeAll(async function() {
    // decimals resolve off the asset's erc20 thing before falling back to chain
    await upsertBatch([{
      chainId: mainnet.id, address: USDC, label: 'erc20',
      defaults: { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
    }] as types.Thing[], 'thing', 'chain_id, address, label')
  })

  afterAll(async function() {
    await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
      [mainnet.id, USDC, 'erc20'])
  })

  it('emits system backing normalized to asset decimals', async function() {
    const outputs = await process_(mainnet.id, controller, {
      abiPath: 'yearn/3/tranche/controller', chainId: mainnet.id, address: controller,
      outputLabel: 'tranche-system', blockTime: BLOCK_TIME
    })

    expect(outputs.map(output => output.component)).to.deep.equal([
      'totalClaims', 'vaultAssets', 'reserveAssets', 'backingAssets', 'coverageRatio'
    ])

    const component = (name: string) => outputs.find(output => output.component === name)?.value

    // the deployment holds ~2k USDC of claims against ~2k of backing
    expect(component('totalClaims')).to.be.greaterThan(2000)
    expect(component('vaultAssets')).to.be.greaterThan(2000)
    expect(component('backingAssets')).to.be.greaterThan(2000)
    expect(component('coverageRatio')).to.be.closeTo(1, 0.01)

    // backing is vault assets plus reserve; no reserve vault is set yet
    expect(component('reserveAssets')).to.equal(0)
    expect(component('backingAssets')).to.equal(component('vaultAssets'))
  })
})
