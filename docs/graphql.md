# GraphQL API

## Endpoint

```
POST https://kong.yearn.fi/api/gql
```

- **CORS**: all origins allowed
- **Introspection**: enabled
- **Explorer**: Apollo embedded sandbox at `/api/gql` in browser

## Usage

Use any GraphQL client, or curl:

```bash
curl -s -X POST https://kong.yearn.fi/api/gql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ latestBlocks { chainId blockNumber } }"}' \
  | jq
```

## Queries

### Vaults

#### `vaults`

List all vaults, sorted by TVL descending.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `addresses` | `[String]` | Filter by addresses |
| `apiVersion` | `String` | Minimum API version (e.g. `"3.0.0"`) |
| `erc4626` | `Boolean` | ERC-4626 vaults only |
| `v3` | `Boolean` | V3 vaults only |
| `yearn` | `Boolean` | Yearn vaults only |
| `origin` | `String` | Filter by origin (e.g. `"yearn"`) |
| `vaultType` | `Int` | Filter by vault type |
| `riskLevel` | `Int` | Filter by risk level |
| `unratedOnly` | `Boolean` | Only unrated vaults |

Returns [`Vault`](#vault-1).

```graphql
{
  vaults(chainId: 1, v3: true) {
    address
    name
    symbol
    tvl { tvl }
  }
}
```

#### `vault`

Single vault lookup.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault address |

Returns [`Vault`](#vault-1).

```graphql
{
  vault(
    chainId: 1
    address: "0x6FAF8b...34C1"
  ) {
    name
    symbol
    decimals
    tvl { tvl close }
  }
}
```

#### `vaultStrategies`

Strategies deployed to a vault.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `vault` | `String` | Vault address |

Returns [`[Strategy]`](#strategy-1).

```graphql
{
  vaultStrategies(
    chainId: 1
    vault: "0x6FAF8b...34C1"
  ) {
    address
    name
    totalDebtUsd
  }
}
```

#### `vaultReports`

StrategyReported events for a vault (limit 1000, sorted by time desc).

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault address |

Returns [`[VaultReport]`](#vaultreport).

```graphql
{
  vaultReports(
    chainId: 1
    address: "0x6FAF8b...34C1"
  ) {
    strategy
    gain
    loss
    currentDebt
    gainUsd
    lossUsd
    apr { gross net }
    blockTime
    transactionHash
  }
}
```

#### `vaultAccounts`

Accounts with roles on a vault.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `vault` | `String` | Vault address |

Returns [`[AccountRole]`](#accountrole).

```graphql
{
  vaultAccounts(
    chainId: 1
    vault: "0x6FAF8b...34C1"
  ) {
    chainId
    address
    account
    roleMask
  }
}
```

### Strategies

#### `strategies`

List all strategies, sorted by totalDebtUsd descending.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `apiVersion` | `String` | Minimum API version |
| `erc4626` | `Boolean` | ERC-4626 strategies only |

Returns [`[Strategy]`](#strategy-1).

```graphql
{
  strategies(chainId: 1) {
    address
    name
    vault
    totalDebtUsd
  }
}
```

#### `strategy`

Single strategy lookup.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Strategy address |

Returns [`Strategy`](#strategy-1).

```graphql
{
  strategy(chainId: 1, address: "0x...") {
    address
    name
    vault
    totalAssets
    totalDebt
  }
}
```

#### `strategyReports`

Reported/Harvested events for a strategy (limit 1000).

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Strategy address |

Returns [`[StrategyReport]`](#strategyreport).

```graphql
{
  strategyReports(
    chainId: 1
    address: "0x..."
  ) {
    profit
    loss
    profitUsd
    lossUsd
    apr { gross net }
    blockTime
    transactionHash
  }
}
```

### Account & Roles

#### `accountRoles`

All roles assigned to an account.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `account` | `String!` | Account address (required) |

Returns [`[AccountRole]`](#accountrole).

```graphql
{
  accountRoles(account: "0x...") {
    chainId
    address
    account
    roleMask
  }
}
```

#### `accountVaults`

Vaults where an account has any role.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `account` | `String!` | Account address (required) |

Returns [`[Vault]`](#vault-1).

```graphql
{
  accountVaults(account: "0x...") {
    address
    name
    tvl { tvl }
  }
}
```

#### `accountStrategies`

Strategies in vaults where an account has roles.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `account` | `String!` | Account address (required) |

Returns [`[Strategy]`](#strategy-1).

```graphql
{
  accountStrategies(account: "0x...") {
    address
    name
    totalDebtUsd
  }
}
```

### Financial Data

#### `prices`

Historical price data for tokens.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Token address |
| `timestamp` | `BigInt` | Filter by timestamp |

Returns [`[Price]`](#price).

```graphql
{
  prices(chainId: 1, address: "0x...") {
    chainId
    address
    priceUsd
    priceSource
    blockNumber
    timestamp
  }
}
```

#### `tvls`

Time-bucketed TVL data.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int!` | Chain ID (required) |
| `address` | `String` | Vault address |
| `period` | `String` | Time bucket (default: `"1 day"`) |
| `limit` | `Int` | Max results (default: 100) |
| `timestamp` | `BigInt` | Start from timestamp |

Returns [`[Tvl]`](#tvl).

```graphql
{
  tvls(
    chainId: 1
    address: "0x..."
    period: "1 day"
    limit: 30
  ) {
    chainId
    address
    value
    priceUsd
    priceSource
    period
    blockNumber
    time
  }
}
```

#### `timeseries`

Generic time-series data query with time-bucket aggregation.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `label` | `String!` | Data label (required) |
| `component` | `String` | Data component |
| `period` | `String` | Time bucket (default: `"1 day"`) |
| `limit` | `Int` | Max results (default: 100) |
| `timestamp` | `BigInt` | Start from timestamp |
| `yearn` | `Boolean` | Yearn vaults only |

Returns [`[Output]`](#output).

```graphql
{
  timeseries(
    chainId: 1
    address: "0x..."
    label: "apy-bwd-delta-pps"
    component: "net"
    limit: 30
  ) {
    chainId
    address
    label
    component
    value
    period
    time
  }
}
```

### Transfers & Deposits

#### `transfers`

ERC20 Transfer events (limit 100).

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Token/vault address |

Returns [`[Transfer]`](#transfer).

```graphql
{
  transfers(chainId: 1, address: "0x...") {
    chainId
    address
    sender
    receiver
    value
    valueUsd
    blockNumber
    blockTime
    logIndex
    transactionHash
  }
}
```

#### `deposits`

Vault Deposit events (limit 100).

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault address |

Returns [`[Deposit]`](#deposit).

```graphql
{
  deposits(chainId: 1, address: "0x...") {
    chainId
    vaultAddress
    amount
    shares
    recipient
  }
}
```

### Protocol Management

#### `accountants`

List all accountant contracts.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |

Returns [`[Accountant]`](#accountant-1).

```graphql
{
  accountants(chainId: 1) {
    chainId
    address
    feeManager
    feeRecipient
    futureFeeManager
    managementFeeThreshold
    performanceFeeThreshold
    maxLoss
    vaultManager
    vaults
  }
}
```

#### `accountant`

Single accountant lookup.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int!` | Chain ID (required) |
| `address` | `String!` | Accountant address (required) |

Returns [`Accountant`](#accountant-1).

```graphql
{
  accountant(chainId: 1, address: "0x...") {
    chainId
    address
    feeManager
    feeRecipient
    futureFeeManager
    managementFeeThreshold
    performanceFeeThreshold
    maxLoss
    vaultManager
    vaults
  }
}
```

#### `allocator`

Debt allocator for a vault.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int!` | Chain ID (required) |
| `vault` | `String!` | Vault address (required) |

Returns [`Allocator`](#allocator-1).

```graphql
{
  allocator(chainId: 1, vault: "0x...") {
    chainId
    address
    vault
  }
}
```

#### `projects`

List role manager projects.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |

Returns [`[Project]`](#project).

```graphql
{
  projects(chainId: 1) {
    chainId
    id
    name
    governance
    roleManager
    registry
    accountant
    debtAllocator
    roleManagerFactory
  }
}
```

### General Queries

#### `things`

Query domain entities by label.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |
| `labels` | `[String]!` | Entity labels (required) |

Returns [`[Thing]`](#thing).

```graphql
{
  things(labels: ["vault"]) {
    chainId
    address
    label
  }
}
```

#### `tokens`

All indexed ERC20 tokens.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |

Returns [`[Erc20]`](#erc20).

```graphql
{
  tokens(chainId: 1) {
    chainId
    address
    symbol
    name
    decimals
  }
}
```

### System

#### `latestBlocks`

Latest indexed block numbers per chain.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |

Returns [`[LatestBlock]`](#latestblock).

```graphql
{
  latestBlocks {
    chainId
    blockNumber
    blockTime
  }
}
```

#### `monitor`

System health: queues, Redis, DB, and ingest metrics.

Returns [`Monitor`](#monitor-1).

```graphql
{
  monitor {
    queues { name waiting active failed }
    redis {
      version
      mode
      os
      uptime
      clients
      memory { total used peak fragmentation }
    }
    db {
      clients
      databaseSize
      indexHitRate
      cacheHitRate
    }
    ingest {
      cpu { usage }
      memory { total used }
    }
    indexStatsJson
  }
}
```

### Event Logs

#### `newSplitterLogs`

NewSplitter event logs.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `splitter` | `String` | Splitter address |
| `manager` | `String` | Manager address |
| `managerRecipient` | `String` | Manager recipient |

Returns [`[NewSplitterLog]`](#newsplitterlog).

```graphql
{
  newSplitterLogs(chainId: 1) {
    chainId
    address
    splitter
    manager
    managerRecipient
    splitee
  }
}
```

#### `newYieldSplitterLogs`

NewYieldSplitter event logs.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `splitter` | `String` | Splitter address |
| `vault` | `String` | Vault address |
| `want` | `String` | Want token address |

Returns [`[NewYieldSplitterLog]`](#newyieldsplitterlog).

```graphql
{
  newYieldSplitterLogs(chainId: 1) {
    chainId
    address
    splitter
    vault
    want
  }
}
```

#### `vestingEscrowCreatedLogs`

VestingEscrowCreated events (chain 1 only).

| Argument | Type | Description |
|----------|------|-------------|
| `recipient` | `String` | Recipient address |

Returns [`[VestingEscrowCreatedLog]`](#vestingescrowcreatedlog).

```graphql
{
  vestingEscrowCreatedLogs(recipient: "0x...") {
    chainId
    funder
    token { address symbol name decimals }
    recipient
    escrow
    amount
    vestingStart
    vestingDuration
    cliffLength
    openClaim
  }
}
```

#### `riskScores`

Legacy risk scoring data.

Returns [`[RiskScoreLegacy]`](#riskscorelegacy).

```graphql
{
  riskScores {
    label
    auditScore
    codeReviewScore
    complexityScore
    protocolSafetyScore
    teamKnowledgeScore
    testingScore
  }
}
```

---

## Types

### Vault

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault contract address |
| `name` | `String` | Vault name |
| `symbol` | `String` | Vault token symbol |
| `apiVersion` | `String` | Vault API version |
| `decimals` | `BigInt` | Token decimals |
| `erc4626` | `Boolean` | Whether vault is ERC-4626 |
| `v3` | `Boolean` | Whether vault is V3 |
| `yearn` | `Boolean` | Whether vault is a Yearn vault |
| `origin` | `String` | Vault origin |
| `vaultType` | `Int` | Vault type identifier |
| `category` | `Int` | Vault category |
| `projectId` | `String` | Associated project ID |
| `projectName` | `String` | Associated project name |
| `activation` | `BigInt` | Activation timestamp |
| `inceptTime` | `BigInt` | Inception timestamp |
| `inceptBlock` | `BigInt` | Inception block number |
| `token` | `String` | Underlying token address |
| `asset` | [`Erc20`](#erc20) | Underlying asset details |
| `pricePerShare` | `BigInt` | Current price per share |
| `totalAssets` | `BigInt` | Total assets under management |
| `totalDebt` | `BigInt` | Total debt to strategies |
| `totalIdle` | `BigInt` | Total idle assets |
| `totalSupply` | `BigInt` | Total share supply |
| `total_supply` | `BigInt` | Total share supply (snake_case alias) |
| `depositLimit` | `BigInt` | Maximum deposit limit |
| `deposit_limit` | `BigInt` | Maximum deposit limit (snake_case alias) |
| `deposit_limit_module` | `String` | Deposit limit module address |
| `availableDepositLimit` | `BigInt` | Available deposit limit |
| `withdraw_limit_module` | `String` | Withdraw limit module address |
| `minimum_total_idle` | `BigInt` | Minimum total idle |
| `maxAvailableShares` | `BigInt` | Max available shares |
| `unlockedShares` | `BigInt` | Unlocked shares |
| `profitMaxUnlockTime` | `BigInt` | Profit max unlock time |
| `profitUnlockingRate` | `BigInt` | Profit unlocking rate |
| `fullProfitUnlockDate` | `BigInt` | Full profit unlock date |
| `lastProfitUpdate` | `BigInt` | Last profit update timestamp |
| `lastReport` | `BigInt` | Last report timestamp |
| `lastReportDetail` | [`ReportDetail`](#reportdetail) | Last report details |
| `managementFee` | `BigInt` | Management fee (bps) |
| `performanceFee` | `BigInt` | Performance fee (bps) |
| `fees` | [`Fees`](#fees) | Fee details |
| `debtRatio` | `BigInt` | Debt ratio |
| `creditAvailable` | `BigInt` | Credit available |
| `debtOutstanding` | `BigInt` | Debt outstanding |
| `expectedReturn` | `BigInt` | Expected return |
| `lockedProfit` | `BigInt` | Locked profit |
| `lockedProfitDegradation` | `BigInt` | Locked profit degradation rate |
| `emergencyShutdown` | `Boolean` | V2 emergency shutdown status |
| `isShutdown` | `Boolean` | V3 shutdown status |
| `governance` | `String` | Governance address |
| `guardian` | `String` | Guardian address |
| `management` | `String` | Management address |
| `rewards` | `String` | Rewards address |
| `accountant` | `String` | Accountant address |
| `allocator` | `String` | Allocator address |
| `registry` | `String` | Registry address |
| `role_manager` | `String` | Role manager address |
| `future_role_manager` | `String` | Future role manager address |
| `use_default_queue` | `Boolean` | Whether default queue is used |
| `get_default_queue` | `[String]` | Default queue |
| `withdrawalQueue` | `[String]` | Withdrawal queue |
| `strategies` | `[String]` | Strategies list |
| `debts` | [`[Debt]`](#debt) | Strategy debt details |
| `roles` | [`[Role]`](#role) | Account roles |
| `risk` | [`RiskScore`](#riskscore) | Risk score |
| `meta` | [`VaultMeta`](#vaultmeta) | Vault metadata |
| `staking` | [`Staking`](#staking) | Staking info |
| `sparklines` | [`Sparklines`](#sparklines) | Sparkline data |
| `tvl` | [`SparklinePoint`](#sparklinepoint) | TVL sparkline |
| `apy` | [`Apy`](#apy) | APY data |
| `performance` | [`Performance`](#performance) | Performance data |
| `DOMAIN_SEPARATOR` | `String` | EIP-712 domain separator |
| `FACTORY` | `String` | Factory address |

### Strategy

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Strategy contract address |
| `name` | `String` | Strategy name |
| `symbol` | `String` | Strategy token symbol |
| `apiVersion` | `String` | API version |
| `decimals` | `Int` | Token decimals |
| `vault` | `String` | Parent vault address |
| `want` | `String` | Want token address |
| `erc4626` | `Boolean` | Whether strategy is ERC-4626 |
| `v3` | `Boolean` | Whether strategy is V3 |
| `yearn` | `Boolean` | Whether strategy is Yearn |
| `origin` | `String` | Strategy origin |
| `isOriginal` | `Boolean` | Whether strategy is original |
| `isActive` | `Boolean` | Whether strategy is active |
| `isShutdown` | `Boolean` | Whether strategy is shut down |
| `emergencyExit` | `Boolean` | Emergency exit flag |
| `inceptTime` | `BigInt` | Inception timestamp |
| `inceptBlock` | `BigInt` | Inception block number |
| `pricePerShare` | `BigInt` | Price per share |
| `totalAssets` | `BigInt` | Total assets |
| `totalDebt` | `BigInt` | Total debt |
| `totalDebtUsd` | `Float` | Total debt in USD |
| `totalIdle` | `BigInt` | Total idle |
| `totalSupply` | `BigInt` | Total supply |
| `balanceOfWant` | `BigInt` | Balance of want token |
| `delegatedAssets` | `BigInt` | Delegated assets |
| `estimatedTotalAssets` | `BigInt` | Estimated total assets |
| `stakedBalance` | `BigInt` | Staked balance |
| `performanceFee` | `Int` | Performance fee |
| `performanceFeeRecipient` | `String` | Performance fee recipient |
| `profitMaxUnlockTime` | `BigInt` | Profit max unlock time |
| `profitUnlockingRate` | `BigInt` | Profit unlocking rate |
| `fullProfitUnlockDate` | `BigInt` | Full profit unlock date |
| `lastReport` | `BigInt` | Last report timestamp |
| `lastReportDetail` | [`ReportDetail`](#reportdetail) | Last report details |
| `keeper` | `String` | Keeper address |
| `strategist` | `String` | Strategist address |
| `management` | `String` | Management address |
| `pendingManagement` | `String` | Pending management address |
| `rewards` | `String` | Rewards address |
| `healthCheck` | `String` | Health check address |
| `doHealthCheck` | `Boolean` | Health check enabled |
| `metadataURI` | `String` | Metadata URI |
| `creditThreshold` | `BigInt` | Credit threshold |
| `baseFeeOracle` | `String` | Base fee oracle address |
| `isBaseFeeAcceptable` | `Boolean` | Whether base fee is acceptable |
| `minReportDelay` | `BigInt` | Minimum report delay |
| `maxReportDelay` | `BigInt` | Maximum report delay |
| `forceHarvestTriggerOnce` | `Boolean` | Force harvest trigger |
| `proxy` | `String` | Proxy address |
| `tradeFactory` | `String` | Trade factory address |
| `gauge` | `String` | Gauge address |
| `crv` | `String` | CRV token address |
| `curveVoter` | `String` | Curve voter address |
| `localKeepCRV` | `BigInt` | Local keep CRV |
| `MAX_FEE` | `Int` | Maximum fee |
| `MIN_FEE` | `Int` | Minimum fee |
| `DOMAIN_SEPARATOR` | `String` | EIP-712 domain separator |
| `FACTORY` | `String` | Factory address |
| `lenderStatuses` | [`[LenderStatus]`](#lenderstatus) | Lender statuses |
| `claims` | [`[Reward]`](#reward) | Claimable rewards |
| `risk` | [`RiskScoreLegacy`](#riskscorelegacy) | Risk score |
| `meta` | [`StrategyMeta`](#strategymeta) | Strategy metadata |
| `sparklines` | [`Sparklines`](#sparklines) | Sparkline data |
| `tvl` | [`SparklinePoint`](#sparklinepoint) | TVL sparkline |
| `apy` | [`Apy`](#apy) | APY data |

### VaultReport

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault address |
| `eventName` | `String` | Event name |
| `strategy` | `String` | Strategy address |
| `gain` | `BigInt` | Gain amount |
| `loss` | `BigInt` | Loss amount |
| `debtPaid` | `BigInt` | Debt paid |
| `totalGain` | `BigInt` | Total gain |
| `totalLoss` | `BigInt` | Total loss |
| `totalDebt` | `BigInt` | Total debt |
| `debtAdded` | `BigInt` | Debt added |
| `debtRatio` | `BigInt` | Debt ratio |
| `currentDebt` | `BigInt` | Current debt |
| `protocolFees` | `BigInt` | Protocol fees |
| `totalFees` | `BigInt` | Total fees |
| `totalRefunds` | `BigInt` | Total refunds |
| `gainUsd` | `Float` | Gain in USD |
| `lossUsd` | `Float` | Loss in USD |
| `debtPaidUsd` | `Float` | Debt paid in USD |
| `totalGainUsd` | `Float` | Total gain in USD |
| `totalLossUsd` | `Float` | Total loss in USD |
| `totalDebtUsd` | `Float` | Total debt in USD |
| `debtAddedUsd` | `Float` | Debt added in USD |
| `currentDebtUsd` | `Float` | Current debt in USD |
| `protocolFeesUsd` | `Float` | Protocol fees in USD |
| `totalFeesUsd` | `Float` | Total fees in USD |
| `totalRefundsUsd` | `Float` | Total refunds in USD |
| `priceUsd` | `Float` | Asset price in USD |
| `priceSource` | `String` | Price source |
| `apr` | [`ReportApr`](#reportapr) | APR data |
| `blockNumber` | `Int` | Block number |
| `blockTime` | `BigInt` | Block timestamp |
| `logIndex` | `Int` | Log index |
| `transactionHash` | `String` | Transaction hash |

### StrategyReport

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Strategy address |
| `eventName` | `String` | Event name |
| `profit` | `BigInt` | Profit amount |
| `loss` | `BigInt` | Loss amount |
| `debtPayment` | `BigInt` | Debt payment |
| `debtOutstanding` | `BigInt` | Debt outstanding |
| `protocolFees` | `BigInt` | Protocol fees |
| `performanceFees` | `BigInt` | Performance fees |
| `profitUsd` | `Float` | Profit in USD |
| `lossUsd` | `Float` | Loss in USD |
| `debtPaymentUsd` | `Float` | Debt payment in USD |
| `debtOutstandingUsd` | `Float` | Debt outstanding in USD |
| `protocolFeesUsd` | `Float` | Protocol fees in USD |
| `performanceFeesUsd` | `Float` | Performance fees in USD |
| `priceUsd` | `Float` | Asset price in USD |
| `priceSource` | `String` | Price source |
| `apr` | [`ReportApr`](#reportapr) | APR data |
| `blockNumber` | `Int` | Block number |
| `blockTime` | `BigInt` | Block timestamp |
| `logIndex` | `Int` | Log index |
| `transactionHash` | `String` | Transaction hash |

### AccountRole

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `account` | `String` | Account address |
| `roleMask` | `BigInt` | Role bitmask |

### Accountant

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Accountant address |
| `feeManager` | `String` | Fee manager address |
| `feeRecipient` | `String` | Fee recipient address |
| `futureFeeManager` | `String` | Future fee manager address |
| `managementFeeThreshold` | `BigInt` | Management fee threshold |
| `performanceFeeThreshold` | `BigInt` | Performance fee threshold |
| `maxLoss` | `BigInt` | Max loss |
| `vaultManager` | `String` | Vault manager address |
| `vaults` | `[String]` | Associated vaults |

### Allocator

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Allocator address |
| `vault` | `String` | Vault address |

### Project

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `id` | `String` | Project ID |
| `name` | `String` | Project name |
| `roleManager` | `String` | Role manager address |
| `registry` | `String` | Registry address |
| `accountant` | `String` | Accountant address |
| `debtAllocator` | `String` | Debt allocator address |
| `roleManagerFactory` | `String` | Role manager factory address |
| `governance` | `String` | Governance address |

### Debt

| Field | Type | Description |
|-------|------|-------------|
| `strategy` | `String` | Strategy address |
| `performanceFee` | `BigInt` | Performance fee |
| `activation` | `BigInt` | Activation timestamp |
| `debtRatio` | `BigInt` | Debt ratio |
| `minDebtPerHarvest` | `BigInt` | Minimum debt per harvest |
| `maxDebtPerHarvest` | `BigInt` | Maximum debt per harvest |
| `lastReport` | `BigInt` | Last report timestamp |
| `totalDebt` | `BigInt` | Total debt |
| `totalDebtUsd` | `Float` | Total debt in USD |
| `totalGain` | `BigInt` | Total gain |
| `totalGainUsd` | `Float` | Total gain in USD |
| `totalLoss` | `BigInt` | Total loss |
| `totalLossUsd` | `Float` | Total loss in USD |
| `currentDebt` | `BigInt` | Current debt |
| `currentDebtUsd` | `Float` | Current debt in USD |
| `maxDebt` | `BigInt` | Maximum debt |
| `maxDebtUsd` | `Float` | Maximum debt in USD |
| `targetDebtRatio` | `Float` | Target debt ratio |
| `maxDebtRatio` | `Float` | Maximum debt ratio |

### Fees

| Field | Type | Description |
|-------|------|-------------|
| `managementFee` | `Float` | Management fee |
| `performanceFee` | `Float` | Performance fee |

### Performance

| Field | Type | Description |
|-------|------|-------------|
| `oracle` | [`Oracle`](#oracle) | Oracle APR/APY |
| `estimated` | [`EstimatedApr`](#estimatedapr) | Estimated APR/APY |
| `historical` | [`Historical`](#historical) | Historical APY |

### Oracle

| Field | Type | Description |
|-------|------|-------------|
| `apr` | `Float` | Annual percentage rate |
| `apy` | `Float` | Annual percentage yield |

### EstimatedApr

| Field | Type | Description |
|-------|------|-------------|
| `apr` | `Float` | Estimated APR |
| `apy` | `Float` | Estimated APY |
| `type` | `String` | APR type |
| `components` | [`EstimatedAprComponents`](#estimatedaprcomponents) | APR breakdown |

### EstimatedAprComponents

| Field | Type | Description |
|-------|------|-------------|
| `boost` | `Float` | Boost component |
| `poolAPY` | `Float` | Pool APY |
| `boostedAPR` | `Float` | Boosted APR |
| `baseAPR` | `Float` | Base APR |
| `rewardsAPR` | `Float` | Rewards APR |
| `rewardsAPY` | `Float` | Rewards APY |
| `cvxAPR` | `Float` | Convex APR |
| `keepCRV` | `Float` | Keep CRV |
| `keepVelo` | `Float` | Keep VELO |

### Historical

| Field | Type | Description |
|-------|------|-------------|
| `net` | `Float` | Net APY |
| `weeklyNet` | `Float` | Weekly net APY |
| `monthlyNet` | `Float` | Monthly net APY |
| `inceptionNet` | `Float` | APY since inception |

### Apy

| Field | Type | Description |
|-------|------|-------------|
| `net` | `Float` | Net APY |
| `pricePerShare` | `BigInt` | Price per share |
| `weeklyNet` | `Float` | Weekly net APY |
| `weeklyPricePerShare` | `BigInt` | Weekly price per share |
| `monthlyNet` | `Float` | Monthly net APY |
| `monthlyPricePerShare` | `BigInt` | Monthly price per share |
| `inceptionNet` | `Float` | APY since inception |
| `grossApr` | `Float` | Gross APR |
| `blockNumber` | `String` | Block number |
| `blockTime` | `String` | Block timestamp |

### ReportApr

| Field | Type | Description |
|-------|------|-------------|
| `gross` | `Float` | Gross APR |
| `net` | `Float` | Net APR |

### ReportDetail

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `blockNumber` | `BigInt` | Block number |
| `blockTime` | `BigInt` | Block timestamp |
| `transactionHash` | `String` | Transaction hash |
| `profit` | `BigInt` | Profit |
| `profitUsd` | `Float` | Profit in USD |
| `loss` | `BigInt` | Loss |
| `lossUsd` | `Float` | Loss in USD |
| `apr` | [`Apr`](#apr) | APR data |

### Apr

| Field | Type | Description |
|-------|------|-------------|
| `gross` | `Float` | Gross APR |
| `net` | `Float` | Net APR |

### Price

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Token address |
| `priceUsd` | `Float` | Price in USD |
| `priceSource` | `String` | Price source |
| `blockNumber` | `BigInt` | Block number |
| `timestamp` | `BigInt` | Timestamp |

### Tvl

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `value` | `Float` | TVL value |
| `priceUsd` | `Float` | Price in USD |
| `priceSource` | `String` | Price source |
| `period` | `String` | Time period |
| `blockNumber` | `Int` | Block number |
| `time` | `BigInt` | Timestamp |

### Output

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `label` | `String` | Data label |
| `component` | `String` | Data component |
| `value` | `Float` | Value |
| `period` | `String` | Time period |
| `time` | `BigInt` | Timestamp |

### Transfer

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Token address |
| `sender` | `String` | Sender address |
| `receiver` | `String` | Receiver address |
| `value` | `Float` | Transfer value |
| `valueUsd` | `Float` | Value in USD |
| `blockNumber` | `BigInt` | Block number |
| `blockTime` | `BigInt` | Block timestamp |
| `logIndex` | `Int` | Log index |
| `transactionHash` | `String` | Transaction hash |

### Deposit

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `vaultAddress` | `String` | Vault address |
| `amount` | `String` | Deposit amount |
| `shares` | `String` | Shares received |
| `recipient` | `String` | Recipient address |

### Erc20

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Token address |
| `symbol` | `String` | Token symbol |
| `name` | `String` | Token name |
| `decimals` | `Int` | Token decimals |

### Thing

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `label` | `String` | Entity label |

### LatestBlock

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `blockNumber` | `BigInt` | Latest block number |
| `blockTime` | `BigInt` | Latest block timestamp |

### Monitor

| Field | Type | Description |
|-------|------|-------------|
| `queues` | [`[QueueStatus]`](#queuestatus) | Queue statuses |
| `redis` | [`RedisInfo`](#redisinfo) | Redis info |
| `db` | [`DbInfo`](#dbinfo) | Database info |
| `ingest` | [`IngestInfo`](#ingestinfo) | Ingest service info |
| `indexStatsJson` | `String` | Index stats as JSON |

### QueueStatus

| Field | Type | Description |
|-------|------|-------------|
| `name` | `String` | Queue name |
| `waiting` | `Int` | Waiting jobs |
| `active` | `Int` | Active jobs |
| `failed` | `Int` | Failed jobs |

### RedisInfo

| Field | Type | Description |
|-------|------|-------------|
| `version` | `String` | Redis version |
| `mode` | `String` | Redis mode |
| `os` | `String` | Operating system |
| `uptime` | `Int` | Uptime in seconds |
| `clients` | `Int` | Connected clients |
| `memory` | [`RedisMemory`](#redismemory) | Memory info |

### RedisMemory

| Field | Type | Description |
|-------|------|-------------|
| `total` | `BigInt` | Total memory |
| `used` | `BigInt` | Used memory |
| `peak` | `BigInt` | Peak memory |
| `fragmentation` | `Float` | Memory fragmentation ratio |

### DbInfo

| Field | Type | Description |
|-------|------|-------------|
| `clients` | `Int` | Connected clients |
| `databaseSize` | `BigInt` | Database size |
| `indexHitRate` | `Float` | Index hit rate |
| `cacheHitRate` | `Float` | Cache hit rate |

### IngestInfo

| Field | Type | Description |
|-------|------|-------------|
| `cpu` | [`IngestCpu`](#ingestcpu) | CPU info |
| `memory` | [`IngestMemory`](#ingestmemory) | Memory info |

### IngestCpu

| Field | Type | Description |
|-------|------|-------------|
| `usage` | `Float` | CPU usage |

### IngestMemory

| Field | Type | Description |
|-------|------|-------------|
| `total` | `BigInt` | Total memory |
| `used` | `BigInt` | Used memory |

### Role

| Field | Type | Description |
|-------|------|-------------|
| `account` | `String` | Account address |
| `roleMask` | `BigInt` | Role bitmask |

### RiskScore

| Field | Type | Description |
|-------|------|-------------|
| `riskLevel` | `Int` | Risk level |
| `riskScore` | [`RiskScoreDetails`](#riskscoredetails) | Risk score details |

### RiskScoreDetails

| Field | Type | Description |
|-------|------|-------------|
| `review` | `Int` | Review score |
| `testing` | `Int` | Testing score |
| `complexity` | `Int` | Complexity score |
| `riskExposure` | `Int` | Risk exposure score |
| `protocolIntegration` | `Int` | Protocol integration score |
| `centralizationRisk` | `Int` | Centralization risk score |
| `externalProtocolAudit` | `Int` | External protocol audit score |
| `externalProtocolCentralisation` | `Int` | External protocol centralization score |
| `externalProtocolTvl` | `Int` | External protocol TVL score |
| `externalProtocolLongevity` | `Int` | External protocol longevity score |
| `externalProtocolType` | `Int` | External protocol type score |
| `comment` | `String` | Comment |

### RiskScoreLegacy

| Field | Type | Description |
|-------|------|-------------|
| `label` | `String` | Label |
| `auditScore` | `Float` | Audit score |
| `codeReviewScore` | `Float` | Code review score |
| `complexityScore` | `Float` | Complexity score |
| `protocolSafetyScore` | `Float` | Protocol safety score |
| `teamKnowledgeScore` | `Float` | Team knowledge score |
| `testingScore` | `Float` | Testing score |

### VaultMeta

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | `String` | Display name |
| `displaySymbol` | `String` | Display symbol |
| `description` | `String` | Description |
| `type` | `String` | Vault type |
| `kind` | `String` | Vault kind |
| `category` | `String` | Vault category |
| `isRetired` | `Boolean` | Whether vault is retired |
| `isHidden` | `Boolean` | Whether vault is hidden |
| `isAggregator` | `Boolean` | Whether vault is an aggregator |
| `isBoosted` | `Boolean` | Whether vault is boosted |
| `isAutomated` | `Boolean` | Whether vault is automated |
| `isHighlighted` | `Boolean` | Whether vault is highlighted |
| `isPool` | `Boolean` | Whether vault is a pool |
| `shouldUseV2APR` | `Boolean` | Whether to use V2 APR |
| `protocols` | `[String]` | Associated protocols |
| `migration` | [`VaultMetaMigration`](#vaultmetamigration) | Migration info |
| `stability` | [`VaultMetaStability`](#vaultmetastability) | Stability info |
| `inclusion` | [`VaultMetaInclusion`](#vaultmetainclusion) | Inclusion flags |
| `sourceURI` | `String` | Source URI |
| `uiNotice` | `String` | UI notice |
| `token` | [`TokenMeta`](#tokenmeta) | Token metadata |

### VaultMetaMigration

| Field | Type | Description |
|-------|------|-------------|
| `available` | `Boolean` | Whether migration is available |
| `target` | `String` | Migration target address |
| `contract` | `String` | Migration contract address |

### VaultMetaStability

| Field | Type | Description |
|-------|------|-------------|
| `stability` | `String` | Stability classification |
| `stableBaseAsset` | `String` | Stable base asset |

### VaultMetaInclusion

| Field | Type | Description |
|-------|------|-------------|
| `isYearn` | `Boolean` | Included in Yearn |
| `isGimme` | `Boolean` | Included in Gimme |
| `isPoolTogether` | `Boolean` | Included in PoolTogether |
| `isCove` | `Boolean` | Included in Cove |
| `isMorpho` | `Boolean` | Included in Morpho |
| `isKatana` | `Boolean` | Included in Katana |
| `isPublicERC4626` | `Boolean` | Is public ERC-4626 |

### TokenMeta

| Field | Type | Description |
|-------|------|-------------|
| `type` | `String` | Token type |
| `icon` | `String` | Icon URL |
| `symbol` | `String` | Symbol |
| `decimals` | `Int` | Decimals |
| `displayName` | `String` | Display name |
| `displaySymbol` | `String` | Display symbol |
| `description` | `String` | Description |
| `category` | `String` | Category |

### StrategyMeta

| Field | Type | Description |
|-------|------|-------------|
| `isRetired` | `Boolean` | Whether strategy is retired |
| `displayName` | `String` | Display name |
| `description` | `String` | Description |
| `protocols` | `[String]` | Associated protocols |

### Staking

| Field | Type | Description |
|-------|------|-------------|
| `address` | `String` | Staking contract address |
| `available` | `Boolean` | Whether staking is available |
| `source` | `String` | Staking source |
| `rewards` | [`[StakingReward]`](#stakingreward) | Staking rewards |

### StakingReward

| Field | Type | Description |
|-------|------|-------------|
| `address` | `String` | Reward token address |
| `name` | `String` | Reward token name |
| `symbol` | `String` | Reward token symbol |
| `decimals` | `Int` | Reward token decimals |
| `price` | `Float` | Reward token price |
| `isFinished` | `Boolean` | Whether rewards are finished |
| `finishedAt` | `BigInt` | Finish timestamp |
| `apr` | `Float` | Staking APR |
| `perWeek` | `Float` | Rewards per week |

### Sparklines

| Field | Type | Description |
|-------|------|-------------|
| `tvl` | [`[SparklinePoint]`](#sparklinepoint) | TVL sparkline |
| `apy` | [`[SparklinePoint]`](#sparklinepoint) | APY sparkline |

### SparklinePoint

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `label` | `String` | Data label |
| `component` | `String` | Data component |
| `blockTime` | `BigInt` | Block timestamp |
| `close` | `Float` | Close value |

### LenderStatus

| Field | Type | Description |
|-------|------|-------------|
| `name` | `String` | Lender name |
| `assets` | `BigInt` | Assets lent |
| `rate` | `BigInt` | Lending rate |
| `address` | `String` | Lender address |

### Reward

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Reward token address |
| `name` | `String` | Token name |
| `symbol` | `String` | Token symbol |
| `decimals` | `Int` | Token decimals |
| `balance` | `BigInt` | Balance |
| `balanceUsd` | `Float` | Balance in USD |

### NewSplitterLog

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `splitter` | `String` | Splitter address |
| `manager` | `String` | Manager address |
| `managerRecipient` | `String` | Manager recipient address |
| `splitee` | `String` | Splitee address |

### NewYieldSplitterLog

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Contract address |
| `splitter` | `String` | Splitter address |
| `vault` | `String` | Vault address |
| `want` | `String` | Want token address |

### VestingEscrowCreatedLog

| Field | Type | Description |
|-------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `funder` | `String` | Funder address |
| `token` | [`Erc20`](#erc20) | Vesting token |
| `recipient` | `String` | Recipient address |
| `escrow` | `String` | Escrow contract address |
| `amount` | `BigInt` | Vesting amount |
| `vestingStart` | `BigInt` | Vesting start timestamp |
| `vestingDuration` | `BigInt` | Vesting duration |
| `cliffLength` | `BigInt` | Cliff length |
| `openClaim` | `Boolean` | Whether claim is open |

---

## Custom Scalars

- **`BigInt`** -- Large blockchain numbers, serialized as strings in JSON responses.

## Caching

GraphQL response caching is available when `GQL_ENABLE_CACHE=true`:

- **Backend**: Redis (configured via `GQL_CACHE_REDIS_URL`)
- **Default TTL**: 300 seconds (configurable via `GQL_DEFAULT_CACHE_MAX_AGE`)
- Per-field cache directives control TTL for each query
