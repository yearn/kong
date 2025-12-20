# Snapshot API Design

## Overview

High-performance snapshot API endpoint for vault state backed by Redis cache, updated via scheduled GitHub Actions workflow. Provides cached read access at the edge to current vault snapshots without hitting the database.

## Architecture

### Core Components

1. **Database Layer** (`packages/web/app/api/rest/snapshot/db.ts`)
   - `getVaults()`: Fetches all vaults from the `thing` table for iteration
   - `getVaultSnapshot(chainId, address)`: Replicates the GraphQL vault resolver query, combining `thing.defaults`, `snapshot.snapshot`, and `snapshot.hook` into a single object

2. **Redis Cache Layer** (uses existing `@keyv/redis`)
   - Key format: `snapshot:${chainId}:${address.toLowerCase()}`
   - Value: Full snapshot JSON object with all merged fields
   - No TTL (refresh-only updates)
   - Case-insensitive lookups via lowercase normalization

3. **API Route** (`packages/web/app/api/rest/snapshot/[chainId]/[address]/route.ts`)
   - Simple cache read endpoint
   - CORS-enabled for cross-origin access
   - HTTP cache headers (15-minute max-age)
   - Returns 404 when cache miss

4. **Refresh Script** (`packages/web/app/api/rest/snapshot/refresh.ts`)
   - Batch processing (10 concurrent vaults)
   - Iterates all vaults, queries latest snapshot, stores in Redis
   - Logs progress every 10 vaults

5. **GitHub Workflow** (`.github/workflows/snapshot-refresh.yml`)
   - 15-minute cron schedule
   - Executes refresh script with DB and Redis credentials

## Data Flow

### Refresh Workflow (Every 15 minutes)

1. Script calls `getVaults()` to fetch all vault addresses
2. Process vaults in batches of 10 concurrently
3. For each vault:
   - Call `getVaultSnapshot(chainId, address)` to get current state
   - If snapshot exists, store in Redis: `snapshot:${chainId}:${address.toLowerCase()}`
   - If snapshot is null, skip and continue
4. Log progress every 10 vaults processed

### API Request Flow

1. Client requests `GET /api/rest/snapshot/[chainId]/[address]`
2. Route normalizes address to lowercase
3. Construct Redis key: `snapshot:${chainId}:${address.toLowerCase()}`
4. Read from Redis cache
5. If found: return JSON with cache headers (15min max-age, CORS)
6. If not found: return 404 with CORS headers

## Key Design Decisions

- **Address normalization**: All addresses stored and queried in lowercase for case-insensitive lookups
- **No query parameters**: Snapshots return full objects (no component filtering)
- **Cache-only reads**: API never falls back to database
- **Graceful degradation**: Missing snapshots return 404
- **Batch processing**: 10 concurrent vaults balances throughput and database load
- **No TTL**: Cache entries persist until next refresh (Option A strategy)

## Error Handling

### Database Query Errors

- `getVaultSnapshot()` returns `null` when vault doesn't exist
- Refresh script skips null snapshots and continues
- Database connection errors fail the workflow run

### Redis Errors

- Redis connection failures during refresh: script fails, workflow reports failure
- Redis read failures in API route: throw error, return 500
- Cache miss: return 404 (not an error)

### API Route Edge Cases

- Invalid route parameters: return 400 Bad Request
- Case variations in address: normalized to lowercase
- Address checksum validation: not performed
- Vault exists in DB but not in cache: returns 404
- Stale data: serves last successful cache entry indefinitely

### Workflow Failure Scenarios

- Database/Redis unreachable: workflow fails, existing cache remains
- Partial batch failure: continues processing, reports total processed
- No TTL means stale data persists until next successful refresh

## Testing Strategy

### Local Development Setup

Three-terminal workflow:
1. Terminal 1: `docker run --rm -p 6379:6379 redis:latest`
2. Terminal 2: Configure `.env.local` with webops read replica + Redis URL, run `bun dev`
3. Terminal 3: Execute refresh script and test with curl

### Test Cases

```bash
# Populate cache
bun app/api/rest/snapshot/refresh.ts

# Test successful lookup
curl 'http://localhost:3000/api/rest/snapshot/1/0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204'

# Test case-insensitive (lowercase)
curl 'http://localhost:3000/api/rest/snapshot/1/0xbe53a109b494e5c9f97b9cd39fe969be68bf6204'

# Test case-insensitive (mixed)
curl 'http://localhost:3000/api/rest/snapshot/1/0xBE53a109B494e5C9F97B9cd39fE969bE68bf6204'

# Test 404 for non-existent vault
curl 'http://localhost:3000/api/rest/snapshot/1/0x0000000000000000000000000000000000000000'

# Verify CORS headers
curl -I 'http://localhost:3000/api/rest/snapshot/1/0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204'

# Test OPTIONS preflight
curl -X OPTIONS 'http://localhost:3000/api/rest/snapshot/1/0xBe53A109B494E5c9f97b9Cd39Fe969BE68BF6204'
```

## Acceptance Criteria

- Database functions return correct data shape matching GraphQL resolver
- Refresh script successfully processes all vaults in batches
- API returns full snapshot object: `{ chainId, address, ...defaults, ...snapshot, ...hook }`
- Case-insensitive lookups work (uppercase/lowercase/mixed)
- CORS headers present on all responses
- Cache-Control headers enable 15-minute downstream caching
- 404 returned for cache misses

## Configuration

- Uses `REST_CACHE_REDIS_URL` from `packages/web/.env.local`
- Database credentials via standard `POSTGRES_*` environment variables
- No new dependencies required (`@keyv/redis` already present)
