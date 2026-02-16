# REST API

## Base URL

```
http://localhost:3001/api/rest
```

All endpoints are public, CORS-enabled (all origins), and return JSON. REST responses are served from a Redis cache with `Cache-Control: public, max-age=900, s-maxage=900, stale-while-revalidate=600`.

## Endpoints

### List Vaults

#### `GET /api/rest/list/vaults`

All vaults across all chains, sorted by TVL descending.

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `origin` | `string` | Filter by origin (e.g. `"yearn"`) |

```bash
# all vaults
curl -s http://localhost:3001/api/rest/list/vaults | jq

# yearn vaults only
curl -s 'http://localhost:3001/api/rest/list/vaults?origin=yearn' | jq
```

**Response**

```json
[
  {
    "chainId": 1,
    "address": "0x6FAF8b7fFeE3306EfcFc2BA9Fec912b4d49834C1",
    "name": "USDC yVault",
    "symbol": "yvUSDC",
    "apiVersion": "3.0.3",
    "decimals": 6,
    "asset": {
      "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "name": "USD Coin",
      "symbol": "USDC",
      "decimals": 6
    },
    "tvl": 12345678.90,
    "performance": {
      "oracle": { "apr": 0.045, "apy": 0.046 },
      "historical": { "net": 0.042, "weeklyNet": 0.041, "monthlyNet": 0.043, "inceptionNet": 0.05 },
      "estimated": { "apr": 0.044, "apy": 0.045, "type": "base", "components": {} }
    },
    "fees": { "managementFee": 0, "performanceFee": 1000 },
    "category": "Stablecoin",
    "v3": true,
    "isRetired": false,
    "isHidden": false,
    "isBoosted": false,
    "isHighlighted": true,
    "strategiesCount": 3,
    "riskLevel": 1,
    "origin": "yearn",
    "staking": { "address": "0x...", "available": true },
    "pricePerShare": 1.05
  }
]
```

---

#### `GET /api/rest/list/vaults/:chainId`

Vaults for a specific chain.

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID (1, 10, 137, 250, 8453, 42161) |

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `origin` | `string` | Filter by origin |

```bash
# ethereum vaults
curl -s http://localhost:3001/api/rest/list/vaults/1 | jq

# arbitrum yearn vaults
curl -s 'http://localhost:3001/api/rest/list/vaults/42161?origin=yearn' | jq
```

---

### Vault Snapshot

#### `GET /api/rest/snapshot/:chainId/:address`

Current state snapshot for a single vault.

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID |
| `address` | `string` | Vault address (lowercase) |

```bash
curl -s http://localhost:3001/api/rest/snapshot/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
```

**Response**

```json
{
  "chainId": 1,
  "address": "0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1",
  "name": "USDC yVault",
  "symbol": "yvUSDC",
  "apiVersion": "3.0.3",
  "decimals": 6,
  "pricePerShare": 1050000,
  "tvl": { "tvl": 12345678.90, "close": 12345678.90 },
  "performance": { "...": "..." },
  "asset": { "address": "0x...", "name": "USD Coin", "symbol": "USDC", "decimals": 6 },
  "fees": { "managementFee": 0, "performanceFee": 1000 }
}
```

**Errors**: `400` invalid params, `404` vault not found.

---

### Timeseries

#### `GET /api/rest/timeseries/:segment/:chainId/:address`

Historical timeseries data for a vault.

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `segment` | `string` | Data segment (see table below) |
| `chainId` | `number` | Chain ID |
| `address` | `string` | Vault address (lowercase) |

**Segments**

| Segment | Label | Default Component | Description |
|---------|-------|-------------------|-------------|
| `pps` | `pps` | `humanized` | Price per share |
| `apy-historical` | `apy-bwd-delta-pps` | `net` | Historical APY |
| `apr-oracle` | `apr-oracle` | `apr` | Oracle APR |
| `tvl` | `tvl-c` | `tvl` | Total value locked |

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `components` | `string[]` | Override default component(s) |

```bash
# historical APY
curl -s http://localhost:3001/api/rest/timeseries/apy-historical/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq

# TVL timeseries
curl -s http://localhost:3001/api/rest/timeseries/tvl/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq

# price per share
curl -s http://localhost:3001/api/rest/timeseries/pps/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
```

**Response**

```json
[
  { "time": 1700000000, "component": "net", "value": 0.045 },
  { "time": 1700086400, "component": "net", "value": 0.046 }
]
```

**Errors**: `400` invalid params, `404` segment not found.

---

### Vault Reports

#### `GET /api/rest/reports/:chainId/:address`

StrategyReported events for a vault (up to 1000, sorted by time descending).

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID |
| `address` | `string` | Vault address (lowercase) |

```bash
curl -s http://localhost:3001/api/rest/reports/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
```

**Response**

```json
[
  {
    "chainId": 1,
    "address": "0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1",
    "eventName": "StrategyReported",
    "strategy": "0x...",
    "gain": "1000000",
    "loss": "0",
    "currentDebt": "5000000000",
    "gainUsd": 1000.00,
    "lossUsd": 0,
    "currentDebtUsd": 5000000.00,
    "apr": { "gross": 0.05, "net": 0.045 },
    "blockNumber": 19000000,
    "blockTime": "1700000000",
    "transactionHash": "0x..."
  }
]
```

---

## Non-REST Endpoints

### Message Queue Dashboard (dev only)

#### `GET /api/mq`

BullMQ queue monitoring. Only available when `NODE_ENV=development`.

```bash
# all queue stats
curl -s http://localhost:3001/api/mq | jq

# single queue
curl -s 'http://localhost:3001/api/mq?queue=fanout' | jq

# queue jobs by status
curl -s 'http://localhost:3001/api/mq?queue=extract&status=failed&start=0&end=10' | jq
```

**Response (all queues)**

```json
[
  {
    "name": "fanout",
    "waiting": 0,
    "active": 2,
    "completed": 150,
    "failed": 3,
    "delayed": 0,
    "paused": 0,
    "prioritized": 0,
    "isPaused": false
  }
]
```

---

### Webhook Health Check

#### `POST /api/webhook-healthcheck`

Receives webhook callbacks from the indexer for vault health monitoring.

**Authentication**: HMAC-SHA256 signature via `Kong-Signature` header (format: `t=<timestamp>,v1=<signature>`). Requires `WEBHOOK_SECRET` env var.

```bash
curl -s -X POST http://localhost:3001/api/webhook-healthcheck \
  -H 'Content-Type: application/json' \
  -H 'Kong-Signature: t=1700000000,v1=abc123...' \
  -d '{
    "abiPath": "yearn/3/vault",
    "chainId": 1,
    "blockNumber": "19000000",
    "blockTime": "1700000000",
    "subscription": {
      "id": "sub-1",
      "url": "http://localhost:3001/api/webhook-healthcheck",
      "abiPath": "yearn/3/vault",
      "type": "timeseries",
      "labels": ["vault"]
    },
    "vaults": ["0x6FAF8b7fFeE3306EfcFc2BA9Fec912b4d49834C1"]
  }'
```

**Errors**: `401` invalid/missing signature, `400` invalid body.
