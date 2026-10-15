import { expect } from 'chai'
import { decodeEventLog, encodeAbiParameters, getAddress, pad, toEventSelector } from 'viem'
import { HarvestSchema, topics } from './hook'
import vaultAbi from '../../abi'
import abiutil from '../../../../../../abiutil'

const selectors = {
  reported: toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 debtPaid, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)'),
  reportedLegacy: toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtRatio)')
}

describe('abis/yearn/2/vault/event/StrategyReported/hook', () => {
  it('decodes both StrategyReported arities from the single vault abi', function() {
    const reportedEvents = abiutil.events(vaultAbi).filter((e: { name: string }) => e.name === 'StrategyReported')
    expect(reportedEvents.map((e: never) => toEventSelector(e))).to.have.members([selectors.reported, selectors.reportedLegacy])
    expect(topics).to.have.members([selectors.reported, selectors.reportedLegacy])

    const strategy = getAddress('0x8000000000000000000000000000000000000002')

    const legacy = decodeEventLog({
      abi: vaultAbi,
      topics: [selectors.reportedLegacy, pad(strategy)],
      data: encodeAbiParameters([
        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }
      ], [1n, 0n, 1n, 0n, 1n, 0n, 100n])
    })
    expect(legacy.eventName).to.equal('StrategyReported')
    expect(legacy.args).to.deep.equal({ strategy, gain: 1n, loss: 0n, totalGain: 1n, totalLoss: 0n, totalDebt: 1n, debtAdded: 0n, debtRatio: 100n })

    const modern = decodeEventLog({
      abi: vaultAbi,
      topics: [selectors.reported, pad(strategy)],
      data: encodeAbiParameters([
        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }
      ], [1n, 0n, 5n, 1n, 0n, 1n, 0n, 100n])
    })
    expect(modern.eventName).to.equal('StrategyReported')
    expect(modern.args).to.deep.equal({ strategy, gain: 1n, loss: 0n, debtPaid: 5n, totalGain: 1n, totalLoss: 0n, totalDebt: 1n, debtAdded: 0n, debtRatio: 100n })
  })

  it('covers 0.2.x debtLimit reports with the same legacy selector', function() {
    expect(toEventSelector('event StrategyReported(address indexed strategy, uint256 gain, uint256 loss, uint256 totalGain, uint256 totalLoss, uint256 totalDebt, uint256 debtAdded, uint256 debtLimit)'))
      .to.equal(selectors.reportedLegacy)
  })

  it('defaults debtPaid to 0n for legacy harvests', function() {
    const strategy = getAddress('0x8000000000000000000000000000000000000002')

    const legacy = HarvestSchema.parse({
      chainId: 1,
      address: strategy,
      blockNumber: 1n,
      blockTime: 1n,
      args: { strategy, gain: 1n, loss: 0n, totalGain: 1n, totalLoss: 0n, totalDebt: 1n, debtAdded: 0n, debtRatio: 100n }
    })
    expect(legacy.args.debtPaid).to.equal(0n)

    const modern = HarvestSchema.parse({
      chainId: 1,
      address: strategy,
      blockNumber: 1n,
      blockTime: 1n,
      args: { strategy, gain: 1n, loss: 0n, debtPaid: 5n, totalGain: 1n, totalLoss: 0n, totalDebt: 1n, debtAdded: 0n, debtRatio: 100n }
    })
    expect(modern.args.debtPaid).to.equal(5n)
  })
})
