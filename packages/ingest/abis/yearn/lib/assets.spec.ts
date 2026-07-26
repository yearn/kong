import { expect } from 'chai'
import { ThingSchema } from 'lib/types'
import { parseAbi } from 'viem'
import { mainnet } from 'viem/chains'
import { rpcs } from '../../../rpcs'
import { addresses } from '../../../test-addresses'
import { computeTranchePps, readAuthoritativeAssets, readPps } from './assets'

// Fixed block on the deployed yTranche system, so the expected values below are
// reproducible against chain state rather than a moving target.
const BLOCK = 25600000n

const tranche = ThingSchema.parse({
  chainId: mainnet.id,
  address: addresses.tranche.a,
  label: 'vault',
  defaults: {
    decimals: 6,
    asset: addresses.tranche.usdc,
    apiVersion: '3.1.0',
    trancheController: addresses.tranche.controller
  }
})

const ordinary = ThingSchema.parse({
  chainId: mainnet.id,
  address: addresses.tranche.mainVault,
  label: 'vault',
  defaults: {
    decimals: 6,
    asset: addresses.tranche.usdc,
    apiVersion: '3.1.0'
  }
})

describe('abis/yearn/lib/assets', function() {
  it('reads ordinary vault assets from totalAssets()', async function() {
    const totalAssets = await rpcs.next(mainnet.id, BLOCK).readContract({
      address: ordinary.address, abi: parseAbi(['function totalAssets() view returns (uint256)']),
      functionName: 'totalAssets', blockNumber: BLOCK
    })

    expect(await readAuthoritativeAssets(ordinary, BLOCK)).to.equal(totalAssets)
    expect(await readAuthoritativeAssets(ordinary, BLOCK)).to.equal(2101403879n)
  })

  it('reads tranche assets from the controller', async function() {
    const liveAssets = await rpcs.next(mainnet.id, BLOCK).readContract({
      address: addresses.tranche.controller,
      abi: parseAbi(['function liveAssets(address) view returns (uint256)']),
      functionName: 'liveAssets', args: [addresses.tranche.a], blockNumber: BLOCK
    })

    expect(await readAuthoritativeAssets(tranche, BLOCK)).to.equal(liveAssets)
    expect(await readAuthoritativeAssets(tranche, BLOCK)).to.equal(1000448417n)
  })

  it('prices tranche shares from authoritative assets and supply', async function() {
    const assets = await readAuthoritativeAssets(tranche, BLOCK)
    const totalSupply = await rpcs.next(mainnet.id, BLOCK).readContract({
      address: tranche.address, abi: parseAbi(['function totalSupply() view returns (uint256)']),
      functionName: 'totalSupply', blockNumber: BLOCK
    })

    const expected = assets! * 10n ** 6n / totalSupply
    expect(await readPps(tranche, BLOCK)).to.equal(expected)
    expect(await readPps(tranche, BLOCK)).to.equal(1000448n)
  })

  it('prices ordinary vault shares from pricePerShare()', async function() {
    const pricePerShare = await rpcs.next(mainnet.id, BLOCK).readContract({
      address: ordinary.address, abi: parseAbi(['function pricePerShare() view returns (uint256)']),
      functionName: 'pricePerShare', blockNumber: BLOCK
    })

    expect(await readPps(ordinary, BLOCK)).to.equal(pricePerShare)
    expect(await readPps(ordinary, BLOCK)).to.equal(1004716n)
  })

  it('returns the share scale when supply is zero', function() {
    // an empty tranche has no meaningful ratio; one share is worth one asset
    expect(computeTranchePps(0n, 0n, 10n ** 6n)).to.equal(10n ** 6n)
    expect(computeTranchePps(1_000_000n, 0n, 10n ** 18n)).to.equal(10n ** 18n)
  })

  it('computes pps as assets * scale / supply', function() {
    expect(computeTranchePps(1000448417n, 999999744n, 10n ** 6n)).to.equal(1000448n)
    expect(computeTranchePps(2_000_000n, 1_000_000n, 10n ** 6n)).to.equal(2_000_000n)
  })
})
