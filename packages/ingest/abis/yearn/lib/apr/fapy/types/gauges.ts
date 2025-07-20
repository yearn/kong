interface PoolUrls {
  swap: string[];
  deposit: string[];
  withdraw: string[];
}

interface GaugeData {
  inflation_rate: string;
  working_supply: string;
}

interface GaugeController {
  gauge_relative_weight: string;
  gauge_future_relative_weight: string;
  get_gauge_weight: string;
  inflation_rate: string;
}

export interface Gauge {
  isPool: boolean;
  name: string;
  shortName: string;
  poolUrls: PoolUrls;
  poolAddress: string;
  virtualPrice: number;
  factory: boolean;
  type: string; // "stable"
  swap: string;
  swap_token: string;
  lpTokenPrice: number | null;
  blockchainId: string; // "ethereum"
  gauge: string;
  gauge_data: GaugeData;
  gauge_controller: GaugeController;
  gaugeCrvApy: [number, number];
  gaugeFutureCrvApy: [number, number];
  side_chain: boolean;
  is_killed: boolean;
  hasNoCrv: boolean;
  swap_data: {
    virtual_price: string;
  }
}
