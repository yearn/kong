// Interface for the individual coins within the pool
interface Coin {
  address: string;
  usdPrice: number;
  decimals: string; // Represented as string in JSON
  isBasePoolLpToken: boolean;
  symbol: string;
  name: string;
  poolBalance: string; // Large number represented as string
}

// Interface for the pool URLs (can reuse from the previous example)
interface PoolUrls {
  swap: string[];
  deposit: string[];
  withdraw: string[];
}

// Interface for the 'hasMethods' object
interface HasMethods {
  exchange_received: boolean;
  exchange_extended: boolean;
}

// Main interface for the entire pool details object
export interface CrvPool {
  id: string;
  address: string;
  coinsAddresses: string[];
  decimals: string[]; // Array of numbers as strings
  virtualPrice: string; // Large number represented as string
  amplificationCoefficient: string; // Number represented as string
  totalSupply: string; // Very large number represented as string
  name: string;
  assetType: string; // "0"
  lpTokenAddress: string;
  priceOracle: null; // Could potentially be another type if not always null
  priceOracles: null; // Could potentially be another type if not always null
  symbol: string;
  implementation: string;
  assetTypeName: string;
  coins: Coin[]; // Array of Coin objects
  poolUrls: PoolUrls; // PoolUrls object
  usdTotal: number;
  isMetaPool: boolean;
  usdTotalExcludingBasePool: number;
  gaugeAddress: string;
  gaugeRewards: any[]; // Array was empty, using 'any[]'. Define specific type if structure is known.
  gaugeCrvApy: [number, number]; // Tuple of two numbers
  gaugeFutureCrvApy: [number, number]; // Tuple of two numbers
  usesRateOracle: boolean;
  isBroken: boolean;
  hasMethods: HasMethods; // HasMethods object
  creationTs: number; // Timestamp
  creationBlockNumber: number;
  blockchainId: string; // e.g., "ethereum"
  registryId: string; // e.g., "main"
}
