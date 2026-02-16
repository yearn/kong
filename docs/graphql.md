# GraphQL API

## Endpoint

```
POST /api/gql
GET  /api/gql
```

- **CORS**: all origins allowed
- **Introspection**: enabled
- **Explorer**: Apollo Studio sandbox at `/api/gql` in browser

## Usage

Use any GraphQL client, or curl:

```bash
curl -s -X POST http://localhost:3001/api/gql \
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
    blockTime
  }
}
```

#### `vaultAccounts`

Accounts with roles on a vault.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `vault` | `String` | Vault address |

```graphql
{
  vaultAccounts(
    chainId: 1
    vault: "0x6FAF8b...34C1"
  ) {
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

```graphql
{
  strategyReports(
    chainId: 1
    address: "0x..."
  ) {
    profit
    loss
    totalFees
    profitUsd
    lossUsd
    blockTime
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

```graphql
{
  accountRoles(account: "0x...") {
    chainId
    address
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

```graphql
{
  prices(chainId: 1, address: "0x...") {
    priceUsd
    priceSource
    blockNumber
    blockTime
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

```graphql
{
  tvls(
    chainId: 1
    address: "0x..."
    period: "1 day"
    limit: 30
  ) {
    value
    priceUsd
    period
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

```graphql
{
  timeseries(
    chainId: 1
    address: "0x..."
    label: "apy-bwd-delta-pps"
    component: "net"
    limit: 30
  ) {
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

```graphql
{
  transfers(chainId: 1, address: "0x...") {
    sender
    receiver
    value
    valueUsd
    blockTime
  }
}
```

#### `deposits`

Vault Deposit events (limit 100).

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Chain ID |
| `address` | `String` | Vault address |

```graphql
{
  deposits(chainId: 1, address: "0x...") {
    amount
    shares
    recipient
    blockTime
  }
}
```

### Protocol Management

#### `accountants`

List all accountant contracts.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int` | Filter by chain |

```graphql
{
  accountants(chainId: 1) {
    address
    feeManager
    feeRecipient
  }
}
```

#### `accountant`

Single accountant lookup.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int!` | Chain ID (required) |
| `address` | `String!` | Accountant address (required) |

```graphql
{
  accountant(chainId: 1, address: "0x...") {
    feeManager
    feeRecipient
  }
}
```

#### `allocator`

Debt allocator for a vault.

| Argument | Type | Description |
|----------|------|-------------|
| `chainId` | `Int!` | Chain ID (required) |
| `vault` | `String!` | Vault address (required) |

```graphql
{
  allocator(chainId: 1, vault: "0x...") {
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

```graphql
{
  projects(chainId: 1) {
    id
    name
    governance
    roleManager
    registry
    accountant
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

```graphql
{
  tokens(chainId: 1) {
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

```graphql
{
  monitor {
    queues {
      name
      active
      waiting
      completed
      failed
    }
    redis {
      usedMemoryHuman
      connectedClients
    }
    db {
      numBackends
      cacheHitRatio
    }
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

```graphql
{
  newSplitterLogs(chainId: 1) {
    splitter
    manager
    managerRecipient
    blockTime
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

```graphql
{
  newYieldSplitterLogs(chainId: 1) {
    splitter
    vault
    want
    blockTime
  }
}
```

#### `vestingEscrowCreatedLogs`

VestingEscrowCreated events (chain 1 only).

| Argument | Type | Description |
|----------|------|-------------|
| `recipient` | `String` | Recipient address |

```graphql
{
  vestingEscrowCreatedLogs(recipient: "0x...") {
    escrow
    token
    recipient
    amount
    vestingStart
    vestingDuration
    cliffLength
  }
}
```

#### `riskScores`

Legacy risk scoring data.

```graphql
{
  riskScores {
    chainId
    address
    auditScore
    codeReviewScore
    testingScore
  }
}
```

## Custom Scalars

- **`BigInt`** -- Large blockchain numbers, serialized as strings in JSON responses.

## Caching

GraphQL response caching is available when `GQL_ENABLE_CACHE=true`:

- **Backend**: Redis (configured via `GQL_CACHE_REDIS_URL`)
- **Default TTL**: 300 seconds (configurable via `GQL_DEFAULT_CACHE_MAX_AGE`)
- Per-field cache directives control TTL for each query
