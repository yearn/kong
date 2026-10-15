import { expect } from 'chai'
import { types } from 'lib'
import { mainnet } from 'viem/chains'
import { afterAll, beforeAll } from 'vitest'
import { requireHooks } from '../../../../../../index'
import db from '../../../../../../../db'
import { upsertBatch } from '../../../../../../../load'
import { addresses } from '../../../../../../../test-addresses'
import { _compute } from '../../../../../lib/tvl'
import process_ from './hook'

const BLOCK = 25600000n
const BLOCK_TIME = 1784864807n
const { a: TRANCHE, usdc: USDC, controller } = addresses.tranche

const defaults = {
  decimals: 6,
  asset: USDC,
  apiVersion: '3.1.0',
  trancheController: controller,
  tranche: true,
  inceptBlock: 25576299,
  inceptTime: 1784579135
}

describe('abis/yearn/3/tranche/vault/timeseries/tvl-c/hook', function() {
  beforeAll(async function() {
    await upsertBatch(
      [{ chainId: mainnet.id, address: TRANCHE, label: 'vault', defaults }] as types.Thing[],
      'thing', 'chain_id, address, label'
    )
  })

  afterAll(async function() {
    await db.query('DELETE FROM thing WHERE chain_id = $1 AND address = $2 AND label = $3',
      [mainnet.id, TRANCHE, 'vault'])
  })

  it('computes tvl from controller-backed assets', async function() {
    const vault = types.ThingSchema.parse({ chainId: mainnet.id, address: TRANCHE, label: 'vault', defaults })
    const { totalAssets } = await _compute(vault, BLOCK)
    // liveAssets at this block, not the tranche's own totalAssets()
    expect(totalAssets).to.equal(1000448417n)
  })

  it('emits the componentized tvl shape', async function() {
    const outputs = await process_(mainnet.id, TRANCHE, {
      abiPath: 'yearn/3/tranche/vault', chainId: mainnet.id, address: TRANCHE,
      outputLabel: 'tvl-c', blockTime: BLOCK_TIME
    })

    expect(outputs.every(output => output.label === 'tvl-c')).to.equal(true)
    expect(outputs.map(output => output.component)).to.deep.equal([
      'tvl', 'delegated', 'totalAssets', 'delegatedAssets', 'priceUsd'
    ])

    const assets = outputs.find(output => output.component === 'totalAssets')
    expect(assets?.value).to.be.closeTo(1000.448417, 1e-6)

    // tranches hold assets directly; delegation is a pre-3.0.0 vault concept
    expect(outputs.find(output => output.component === 'delegated')?.value).to.equal(0)
    expect(outputs.find(output => output.component === 'delegatedAssets')?.value).to.equal(0)
  })

  it('emits no legacy tvl label', async function() {
    const resolveHooks = await requireHooks()
    const labels = resolveHooks('yearn/3/tranche/vault', 'timeseries')
      .map(hook => hook.module.outputLabel)

    expect(labels).to.include('tvl-c')
    expect(labels).to.not.include('tvl')
  })
})
