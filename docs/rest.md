# REST API

## Base URL

```
https://kong.yearn.fi/api/rest
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
curl -s https://kong.yearn.fi/api/rest/list/vaults | jq

# yearn vaults only
curl -s 'https://kong.yearn.fi/api/rest/list/vaults?origin=yearn' | jq
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
curl -s https://kong.yearn.fi/api/rest/list/vaults/1 | jq

# arbitrum yearn vaults
curl -s 'https://kong.yearn.fi/api/rest/list/vaults/42161?origin=yearn' | jq
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
curl -s https://kong.yearn.fi/api/rest/snapshot/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
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
| `tranche-accounting` | `tranche-accounting` | `liveAssets` | yTranche controller accounting, per tranche address |
| `tranche-system` | `tranche-system` | `backingAssets` | yTranche claims vs backing, at the controller address |

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `components` | `string[]` | Override default component(s) |

```bash
# historical APY
curl -s https://kong.yearn.fi/api/rest/timeseries/apy-historical/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq

# tranche coverage over time (address is the tranche)
curl -s 'https://kong.yearn.fi/api/rest/timeseries/tranche-accounting/1/0x2d4f47208853a3d20eadcbda0f03900771c6eba3?components=coverageRatio' | jq

# system backing over time (address is the controller)
curl -s https://kong.yearn.fi/api/rest/timeseries/tranche-system/1/0xf0145433e5289dd10712650dcd28333fa317ef36 | jq

# TVL timeseries
curl -s https://kong.yearn.fi/api/rest/timeseries/tvl/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq

# price per share
curl -s https://kong.yearn.fi/api/rest/timeseries/pps/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
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

### yTranche

#### `GET /api/rest/tranche/:chainId`

The yTranche system on a chain: controller, asset, main vault, reserve vault,
system accounting, and the tranches in priority order.

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | `number` | Chain ID (Ethereum only, at present) |

```bash
curl -s https://kong.yearn.fi/api/rest/tranche/1 | jq
```

**Response**

```json
{
  "chainId": 1,
  "controller": "0xF0145433E5289dd10712650dCd28333FA317eF36",
  "asset": { "address": "0xA0b8...eB48", "name": "USD Coin", "symbol": "USDC", "decimals": 6 },
  "mainVault": "0xDa87123895a043Ed3610155550177C54ce8ba49B",
  "reserveVault": null,
  "accounting": {
    "totalClaims": 2001.200086,
    "vaultAssets": 2000.980609,
    "reserveAssets": 0,
    "backingAssets": 2000.980609,
    "vaultMaxWithdraw": 2000.980608,
    "coverageRatio": 0.99989
  },
  "tranches": [
    {
      "address": "0x2D4F47208853a3D20EADCbdA0F03900771C6Eba3",
      "name": "yvUSD Fixed",
      "symbol": "yvUSD-A",
      "decimals": 6,
      "apiVersion": "3.1.0",
      "priority": 0,
      "trancheType": "base",
      "inceptBlock": 25576299,
      "inceptTime": 1784579135,
      "hook": "0x776DEd3273440f1481d07B6CE916b5d5Fac170dC",
      "hookState": {
        "open": true,
        "rateLimitWindow": 3600,
        "depositLimit": 1000000,
        "depositRateLimit": {
          "used": 1000, "windowStart": 1784581631, "rateLimit": 100000,
          "effectiveUsed": 0, "remaining": 100000
        },
        "withdrawRateLimit": {
          "used": 0, "windowStart": 0, "rateLimit": 100000,
          "effectiveUsed": 0, "remaining": 100000
        },
        "depositCap": 100000,
        "withdrawCap": 2000.980608
      },
      "accounting": {
        "registered": true,
        "accrualPaused": false,
        "excessShareBps": 0,
        "targetRatePerSecondWad": "1584436925",
        "baselineAssets": 1000.000256,
        "lastAccrual": 1784581955,
        "pendingExcess": 0,
        "liveAssets": 1000.800086
      },
      "coverage": { "claim": 1000.800086, "covered": 1000.800086, "ratio": 1 },
      "pricePerShare": { "raw": 1000800, "humanized": 1.0008 },
      "capacity": {
        "deposit": { "cap": 100000, "limit": 1000000 },
        "withdraw": { "cap": 2000.980608 }
      },
      "blockNumber": 25600000,
      "blockTime": 1784590000
    }
  ],
  "blockNumber": 25600000,
  "blockTime": 1784864807
}
```

**Notes**

- Asset amounts are normalized to `asset.decimals`; `pricePerShare` carries both
  the raw and humanized forms, and `targetRatePerSecondWad` stays a raw WAD
  string.
- `hook` is the Hook's address; `hookState` is what that Hook reports for the
  tranche. Both are as of the tranche's own `blockNumber` / `blockTime`, which is
  independent of the system block at the top level.
- `capacity` is deliverable capacity as the Hook derives it — bounded by
  aggregate limits, the fixed-window rate limits, and for withdrawals by
  main-vault liquidity. `coverage` is an accounting measure and is not a
  statement about what can be withdrawn now.
- Rate-limit windows are fixed, not sliding: `effectiveUsed` is zero once the
  snapshot's timestamp passes `windowStart + rateLimitWindow`.
- `pricePerShare` is controller-backed, and `liveAssets` already excludes
  `pendingExcess`. Tranche claims are not additional protocol TVL — see
  [ytranche](ytranche.md).

**Errors**: `400` invalid chainId, `404` no tranche deployment indexed for the chain.

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
curl -s https://kong.yearn.fi/api/rest/reports/1/0x6faf8b7ffee3306efcfc2ba9fec912b4d49834c1 | jq
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
