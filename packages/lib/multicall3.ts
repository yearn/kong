import { mainnet, optimism, gnosis, polygon, fantom, base, arbitrum } from 'viem/chains'
import { customChains } from './chains'
const { mode, sonic, bera } = customChains

export const activations = {
  [mainnet.id]: BigInt(mainnet.contracts.multicall3.blockCreated),
  [optimism.id]: BigInt(optimism.contracts.multicall3.blockCreated),
  [gnosis.id]: BigInt(gnosis.contracts.multicall3.blockCreated),
  [polygon.id]: BigInt(polygon.contracts.multicall3.blockCreated),
  [sonic.id]: BigInt(sonic.contracts.multicall3.blockCreated),
  [fantom.id]: BigInt(fantom.contracts.multicall3.blockCreated),
  [base.id]: BigInt(base.contracts.multicall3.blockCreated),
  [mode.id]: BigInt(mode.contracts.multicall3.blockCreated),
  [arbitrum.id]: BigInt(arbitrum.contracts.multicall3.blockCreated),
  [bera.id]: BigInt(bera.contracts.multicall3.blockCreated)
}

export function getActivation(chainId: number) {
  if(!Object.keys(activations).includes(chainId.toString())) {
    throw new Error(`Chain ${chainId} not supported`)
  }
  return activations[chainId as keyof typeof activations]
}

export function supportsBlock(chainId: number, blockNumber: bigint) {
  if(!Object.keys(activations).includes(chainId.toString())) {
    throw new Error(`Chain ${chainId} not supported`)
  }

  return blockNumber >= activations[chainId as keyof typeof activations]
}
