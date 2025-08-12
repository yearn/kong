import gql from 'graphql-tag'

export default gql`
type VaultMeta {
  displayName: String
  displaySymbol: String
  description: String
  protocols: [String]
  token: TokenMeta
}

type Debt {
  strategy: String
  performanceFee: BigInt
  activation: BigInt
  debtRatio: BigInt
  minDebtPerHarvest: BigInt
  maxDebtPerHarvest: BigInt
  lastReport: BigInt
  totalDebt: BigInt
  totalDebtUsd: Float
  totalGain: BigInt
  totalGainUsd: Float
  totalLoss: BigInt
  totalLossUsd: Float
  currentDebt: BigInt
  currentDebtUsd: Float
  maxDebt: BigInt
  maxDebtUsd: Float
  targetDebtRatio: Float
  maxDebtRatio: Float
}

type Fees {
  managementFee: Float
  performanceFee: Float
}

type Sparklines {
  tvl: [SparklinePoint]
  apy: [SparklinePoint]
}

type Role {
  account: String!
  roleMask: BigInt!
}

type Apy {
  net: Float
  weeklyNet: Float
  monthlyNet: Float
  inceptionNet: Float
  grossApr: Float
  blockNumber: String!
  blockTime: String!
}

type Vault {
  DOMAIN_SEPARATOR: String
  FACTORY: String
  accountant: String
  activation: BigInt
  address: String
  apiVersion: String
  asset: Erc20
  availableDepositLimit: BigInt
  category: Int
  chainId: Int
  creditAvailable: BigInt
  debtOutstanding: BigInt
  debtRatio: BigInt
  decimals: BigInt
  depositLimit: BigInt
  deposit_limit: BigInt
  deposit_limit_module: String
  emergencyShutdown: Boolean
  erc4626: Boolean
  expectedReturn: BigInt
  fullProfitUnlockDate: BigInt
  future_role_manager: String
  get_default_queue: [String]
  governance: String
  guardian: String
  inceptTime: BigInt
  inceptBlock: BigInt
  isShutdown: Boolean
  lastProfitUpdate: BigInt
  lastReport: BigInt
  lastReportDetail: ReportDetail
  lockedProfit: BigInt
  lockedProfitDegradation: BigInt
  management: String
  managementFee: BigInt
  maxAvailableShares: BigInt
  minimum_total_idle: BigInt
  name: String
  performanceFee: BigInt
  pricePerShare: BigInt
  profitMaxUnlockTime: BigInt
  profitUnlockingRate: BigInt
  projectId: String
  projectName: String
  registry: String
  rewards: String
  role_manager: String
  symbol: String
  token: String
  totalAssets: BigInt
  totalDebt: BigInt
  totalIdle: BigInt
  totalSupply: BigInt
  total_supply: BigInt
  unlockedShares: BigInt
  use_default_queue: Boolean
  vaultType: Int
  withdraw_limit_module: String
  withdrawalQueue: [String]
  strategies: [String]
  allocator: String
  debts: [Debt]
  fees: Fees
  risk: RiskScore
  meta: VaultMeta
  sparklines: Sparklines
  tvl: SparklinePoint
  apy: Apy
  roles: [Role]
  v3: Boolean
  yearn: Boolean
}
`
