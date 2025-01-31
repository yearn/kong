import {
  mainnet,
  optimism,
  gnosis,
  polygon,
  fantom,
  base,
  arbitrum,
} from "viem/chains";
import { customChains } from "./chains";
const { mode, sonic } = customChains;

// Define activations first
const activations = {
  [mainnet.id]: 14353601n,
  [optimism.id]: 4286263n,
  [gnosis.id]: 21022491n,
  [polygon.id]: 25770160n,
  [fantom.id]: 33001987n,
  [base.id]: 5022n,
  [arbitrum.id]: 7654707n,
  [mode.id]: 2465882n,
  [sonic.id]: 60n,
} as const;

export function getActivation(chainId: number) {
  if (!Object.keys(activations).includes(chainId.toString())) {
    return undefined;
  }
  return activations[chainId as keyof typeof activations];
}

export function supportsBlock(chainId: number, blockNumber: bigint) {
  if (!Object.keys(activations).includes(chainId.toString())) {
    return false;
  }
  return blockNumber >= activations[chainId as keyof typeof activations];
}
