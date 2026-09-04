import { expect } from 'chai'
import { TestEnvironment, createTestPool, pollForRow, triggerFanout } from 'lib/helpers/containers'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { getSnapshotKey } from '../web/app/api/rest/snapshot/redis'

const CHAIN_ID = 1

// Issue #409: yvusd-estimated-apr leaking into non-yvUSD vault context.
//
// The yvUSD APR service emits two row shapes under label 'yvusd-estimated-apr':
//   - vault-level    -> netAPR, netAPY
//   - strategy-level -> netAPR, netAPY, debtRatio
//
// The OG USDC Compounder (STRATEGY_VAULT) is itself a v3 vault AND a strategy of
// other v3 vaults. Its own snapshot hook resolved estimated APR via the unlabeled
// `LIKE '%-estimated-apr'` fallback, which used to pick up the strategy-level yvUSD
// rows (the ones carrying debtRatio) and claim them as its own estimate. Every
// parent vault embedding it via extractComposition then inherited that yvUSD-scoped
// APR + debtRatio — wrong for non-yvUSD parents. The fix excludes any block_time
// whose row-set contains component='debtRatio' from that fallback.
//
// This covers what unit tests can't: the leak through the real ingest -> web
// pipeline via cross-vault composition (a non-yvUSD parent inheriting the
// strategy's yvUSD-scoped estimate), plus REST/GraphQL read-time parity. The
// pure debtRatio-filter logic is unit-tested in helpers/apy-apr.spec.ts.

const LABEL = 'yvusd-estimated-apr'

// vault-level rows only (no debtRatio) -> KEEPS the estimate, and scopes its
// composition to yvUSD via the explicit-label path.
const YVUSD_VAULT = '0x696d02Db93291651ED510704c9b286841d506987'
const YVUSD_INCEPT = 24271831

// itself a v3 vault, gets strategy-level rows (with debtRatio) -> must NOT claim
// them as its own estimate.
const STRATEGY_VAULT = '0x0e297dE4005883C757c9F09fdF7cF1363C20e626'
const STRATEGY_INCEPT = 21176924

// non-yvUSD parent that also embeds STRATEGY_VAULT in its composition -> must NOT
// inherit the yvUSD-scoped estimate.
const USDC2_VAULT = '0xAe7d8Db82480E6d8e3873ecbF22cf17b3D8A7308'
const USDC2_INCEPT = 21176924

function source(address: string, inceptBlock: number) {
  return { chainId: CHAIN_ID, address, inceptBlock }
}

function manual(address: string, inceptBlock: number) {
  return {
    chainId: CHAIN_ID,
    address,
    label: 'vault',
    defaults: { inceptBlock, origin: 'yearn', apiVersion: '3.0.4' },
  }
}

// All components of one emission MUST share a single block_time. The yvUSD APR
// service writes them together, and getLatestEstimatedAprV3 selects rows by the
// single latest block_time. Splitting components across distinct timestamps lets
// a partial row-set survive the debtRatio filter (e.g. a netAPY-only block_time)
// and masquerade as a leak.
async function seedOutput(pool: Pool, address: string, components: Record<string, number>) {
  const blockTime = new Date()
  for (const [component, value] of Object.entries(components)) {
    await pool.query(
      `INSERT INTO output (chain_id, address, label, component, value, block_number, block_time, series_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [CHAIN_ID, address, LABEL, component, value, 1, blockTime],
    )
  }
}

type Estimated = { type?: string, apr?: number, apy?: number, grossAPR?: number, grossAPY?: number, components?: Record<string, number> }

async function fetchRestSnapshot(webUrl: string, address: string) {
  const res = await fetch(`${webUrl}/api/rest/snapshot/${CHAIN_ID}/${address.toLowerCase()}`)
  expect(res.status).to.equal(200)
  return await res.json() as {
    performance?: { estimated?: Estimated }
    composition?: Array<{ address: string, performance?: { estimated?: Estimated } }>
  }
}

function compositionEntry(
  snapshot: Awaited<ReturnType<typeof fetchRestSnapshot>>,
  strategy: string,
) {
  return snapshot.composition?.find(c => c.address.toLowerCase() === strategy.toLowerCase())
}

async function fetchGqlEstimated(webUrl: string, address: string): Promise<Estimated | undefined> {
  const res = await fetch(`${webUrl}/api/gql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query($chainId: Int!, $address: String!) {
        vault(chainId: $chainId, address: $address) {
          performance { estimated { type apr apy grossAPR grossAPY } }
        }
      }`,
      variables: { chainId: CHAIN_ID, address },
    }),
  })
  expect(res.status).to.equal(200)
  const body = await res.json() as { data?: { vault?: { performance?: { estimated?: Estimated } } } }
  return body.data?.vault?.performance?.estimated
}

type GqlVaultState = {
  pricePerShare?: unknown
  asset?: { symbol?: string, decimals?: number }
}

async function fetchGqlVaultState(webUrl: string, address: string): Promise<GqlVaultState | undefined> {
  const res = await fetch(`${webUrl}/api/gql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query($chainId: Int!, $address: String!) {
        vault(chainId: $chainId, address: $address) {
          pricePerShare
          asset { symbol decimals }
        }
      }`,
      variables: { chainId: CHAIN_ID, address },
    }),
  })
  expect(res.status).to.equal(200)
  const body = await res.json() as { data?: { vault?: GqlVaultState } }
  return body.data?.vault
}

// Gate: composition fully assembled. yvUSD ($2) must resolve the strategy ($4)
// to its yvusd-estimated-apr ($5) via the explicit-label path, AND USDC-2 ($3)
// must embed the same strategy. Both require the strategy's snapshot to exist
// first, so this only passes after >1 fanout pass.
// Params: [chainId($1), yvUSD($2), USDC-2($3), strategy($4), label($5)].
const COMPOSITION_ASSEMBLED_SQL = `
  SELECT 1 WHERE
    EXISTS (
      SELECT 1 FROM snapshot s JOIN thing t
        ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($2) AND t.label = 'vault'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(s.hook->'composition', '[]'::jsonb)) c
          WHERE lower(c->>'address') = lower($4)
            AND c->'performance'->'estimated'->>'type' = $5
        )
    )
    AND EXISTS (
      SELECT 1 FROM snapshot s JOIN thing t
        ON t.chain_id = s.chain_id AND t.address = s.address
      WHERE t.chain_id = $1 AND lower(t.address) = lower($3) AND t.label = 'vault'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(s.hook->'composition', '[]'::jsonb)) c
          WHERE lower(c->>'address') = lower($4)
        )
    )
`

describe('e2e: yvusd-estimated-apr scoping (issue #409)', () => {
  let env: TestEnvironment
  let webUrl: string
  let pool: Pool

  beforeAll(async () => {
    env = new TestEnvironment({
      configs: {
        chains: ['mainnet'],
        // All four addresses register as yearn/3/vault sources, so each gets a vault
        // snapshot carrying hook.performance — which is all the leak path needs:
        // composition resolves from those vault snapshots. The manual repro's extra
        // registry3/strategy ABI paths aren't required to reproduce #409 here.
        abis: [{
          abiPath: 'yearn/3/vault',
          sources: [
            source(YVUSD_VAULT, YVUSD_INCEPT),
            source(STRATEGY_VAULT, STRATEGY_INCEPT),
            source(USDC2_VAULT, USDC2_INCEPT),
          ],
        }],
        manuals: [
          manual(YVUSD_VAULT, YVUSD_INCEPT),
          manual(STRATEGY_VAULT, STRATEGY_INCEPT),
          manual(USDC2_VAULT, USDC2_INCEPT),
        ],
      },
      ingest: true,
      // POSTGRES_SSL is baked truthy in the image's .env; '' forces the web db
      // pool to skip SSL against the test Postgres (which has none).
      web: { env: { POSTGRES_SSL: '' } },
    })

    const result = await env.start()
    webUrl = result.webUrl
    pool = createTestPool()

    // Seed the yvUSD APR service emissions BEFORE the snapshot hooks run, so the
    // first snapshot computation reads them. USDC-2 gets nothing — it must stay clean.
    await seedOutput(pool, YVUSD_VAULT, { netAPR: 0.05, netAPY: 0.051, grossAPR: 0.06, grossAPY: 0.062 })
    await seedOutput(pool, STRATEGY_VAULT, { netAPR: 0.08, netAPY: 0.082, debtRatio: 5000 })

    // Drive fanout until composition is fully assembled (see compositionAssembledSql).
    // abis fanout no-ops while prior ingestion is in flight, and composition needs the
    // strategy snapshots to land first, so re-trigger on each empty poll until it holds.
    await pollForRow(
      pool,
      COMPOSITION_ASSEMBLED_SQL,
      [CHAIN_ID, YVUSD_VAULT, USDC2_VAULT, STRATEGY_VAULT, LABEL],
      { timeoutMs: 15 * 60_000, intervalMs: 15_000, onTick: () => triggerFanout('abis', {}) },
    )

    // StrategyChanged registers every strategy as a vault thing without a name.
    // Test abis have no `things` filter, so those never get snapshotted and
    // refresh-vaults fails Zod on name. Drop orphans; only manuals matter here.
    await pool.query(
      `DELETE FROM thing
       WHERE label = 'vault'
         AND lower(address) NOT IN (lower($1), lower($2), lower($3))`,
      [YVUSD_VAULT, STRATEGY_VAULT, USDC2_VAULT],
    )

    await env.runScript('packages/web/app/api/rest/refresh-vaults.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await env?.stop()
  })

  it('yvUSD composition entry KEEPS yvusd-estimated-apr + debtRatio (explicit-label path)', async function() {
    const snapshot = await fetchRestSnapshot(webUrl, YVUSD_VAULT)
    const entry = compositionEntry(snapshot, STRATEGY_VAULT)
    expect(entry, 'strategy missing from yvUSD composition').to.not.be.undefined
    expect(entry!.performance?.estimated?.type).to.equal(LABEL)
    expect(entry!.performance?.estimated?.components?.debtRatio).to.equal(5000)
  })

  it('non-yvUSD parent composition does NOT inherit yvusd-estimated-apr (issue #409)', async function() {
    const snapshot = await fetchRestSnapshot(webUrl, USDC2_VAULT)
    const entry = compositionEntry(snapshot, STRATEGY_VAULT)
    expect(entry, 'strategy missing from USDC-2 composition').to.not.be.undefined
    const estimated = entry!.performance?.estimated
    expect(
      estimated == null || estimated.type !== LABEL,
      `USDC-2 composition leaked ${JSON.stringify(estimated)}`,
    ).to.equal(true)
  })

  it('yvUSD keeps yvusd-estimated-apr at top level, and REST/GraphQL agree (no read-time divergence)', async function() {
    const [{ performance }, gql] = await Promise.all([
      fetchRestSnapshot(webUrl, YVUSD_VAULT),
      fetchGqlEstimated(webUrl, YVUSD_VAULT),
    ])
    // vault-level rows (no debtRatio) -> estimate survives, scoped to yvUSD.
    expect(performance?.estimated?.type).to.equal(LABEL)
    expect(performance?.estimated?.apr).to.equal(0.05)
    expect(performance?.estimated?.apy).to.equal(0.051)
    expect(performance?.estimated?.grossAPR).to.equal(0.06)
    expect(performance?.estimated?.grossAPY).to.equal(0.062)
    expect(performance?.estimated?.components?.grossAPR).to.equal(undefined)
    expect(performance?.estimated?.components?.grossAPY).to.equal(undefined)
    expect(gql?.type).to.equal(performance?.estimated?.type)
    expect(gql?.apr).to.equal(performance?.estimated?.apr)
    expect(gql?.apy).to.equal(performance?.estimated?.apy)
    expect(gql?.grossAPR).to.equal(performance?.estimated?.grossAPR)
    expect(gql?.grossAPY).to.equal(performance?.estimated?.grossAPY)
  })
})

// Stale hook.pricePerShare shadowing fresh contract state (yvUSD & friends, up to 2.6x off).
//
// Vaults discovered via the erc4626 abi path (before their registry endorsement
// set yearn: true) got a pricePerShare written into snapshot.hook from the pps
// sparkline. Once the yearn/3/vault snapshot hook took over it never emitted the
// key, and upsertSnapshot's shallow hook merge kept the stale value forever. The
// API merged defaults < snapshot < hook, so the dead hook key shadowed the fresh
// multicalled snapshot.pricePerShare.
//
// The fix flips the REST read-layer merge (mergeSnapshot) so contract state wins
// over hook keys, with `asset` kept hook-won (the enriched erc20 object must beat
// the raw asset() address). Both REST and GraphQL resolvers now use the same merge.
// This suite seeds the exact prod row shape (no ingest, no RPC) and
// asserts REST serves the fresh state value while `asset` stays enriched.

const ASSET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const STALE_PPS = 1002336
const FRESH_PPS = '1021955'

const ASSET_ERC20 = { chainId: CHAIN_ID, address: ASSET, name: 'USD Coin', symbol: 'USDC', decimals: 6 }

describe('e2e: contract state wins over stale hook keys', () => {
  let env: TestEnvironment
  let webUrl: string
  let pool: Pool
  let redis: Redis

  beforeAll(async () => {
    env = new TestEnvironment({
      // POSTGRES_SSL is baked truthy in the image's .env; '' forces the web db
      // pool to skip SSL against the test Postgres (which has none).
      web: { env: { POSTGRES_SSL: '' } },
    })

    const result = await env.start()
    webUrl = result.webUrl
    pool = createTestPool()
    redis = new Redis(process.env.REST_CACHE_REDIS_URL || 'redis://localhost:6379')

    await pool.query(
      `INSERT INTO thing (chain_id, address, label, defaults)
       VALUES ($1, $2, 'vault', $3::jsonb)`,
      [CHAIN_ID, YVUSD_VAULT, JSON.stringify({ yearn: true, origin: 'yearn', erc4626: true, apiVersion: '3.0.4', inceptBlock: YVUSD_INCEPT })],
    )

    // The prod row shape: fresh contract state (incl. pricePerShare from the
    // multicall) + a hook blob carrying the erc4626-era stale pricePerShare
    // alongside the hook's own enrichments.
    await pool.query(
      `INSERT INTO snapshot (chain_id, address, snapshot, hook, block_number, block_time)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, 25655096, now())`,
      [
        CHAIN_ID, YVUSD_VAULT,
        JSON.stringify({
          name: 'USD yVault', symbol: 'yvUSD', decimals: 6, apiVersion: '3.0.4',
          asset: ASSET, pricePerShare: FRESH_PPS,
          totalAssets: '9254763666617', totalSupply: '9055945416998',
        }),
        JSON.stringify({
          pricePerShare: STALE_PPS,
          asset: ASSET_ERC20,
          tvl: { close: 9253324.98 },
        }),
      ],
    )

    await env.runScript('packages/web/app/api/rest/refresh-vaults.ts')
  })

  afterAll(async () => {
    await pool?.end()
    await redis?.quit()
    await env?.stop()
  })

  it('REST snapshot serves state pricePerShare, not the stale hook key', async function() {
    const res = await fetch(`${webUrl}/api/rest/snapshot/${CHAIN_ID}/${YVUSD_VAULT.toLowerCase()}`)
    expect(res.status).to.equal(200)
    const snapshot = await res.json() as { pricePerShare?: unknown, asset?: { symbol?: string, decimals?: number } }
    expect(snapshot.pricePerShare).to.equal(FRESH_PPS)
    // asset stays the hook-enriched erc20 object, not the raw asset() address
    expect(snapshot.asset?.symbol).to.equal('USDC')
    expect(snapshot.asset?.decimals).to.equal(6)
  })

  it('REST vault list serves state pricePerShare, not the stale hook key', async function() {
    const res = await fetch(`${webUrl}/api/rest/list/vaults`)
    expect(res.status).to.equal(200)
    const vaults = await res.json() as Array<{ address?: string, pricePerShare?: unknown }>
    const vault = vaults.find((item) => item.address?.toLowerCase() === YVUSD_VAULT.toLowerCase())

    expect(vault).to.not.equal(undefined)
    expect(String(vault?.pricePerShare)).to.equal(FRESH_PPS)
  })

  it('GraphQL vault query serves state pricePerShare, not the stale hook key', async function() {
    const vault = await fetchGqlVaultState(webUrl, YVUSD_VAULT)

    expect(vault?.pricePerShare).to.equal('1021955')
    expect(vault?.asset?.symbol).to.equal('USDC')
    expect(vault?.asset?.decimals).to.equal(6)
  })

  it('cached snapshot payload for yvUSD contains state price & enriched asset', async function() {
    const raw = await redis.get(getSnapshotKey(CHAIN_ID, YVUSD_VAULT))
    expect(raw).to.not.equal(null)
    const snapshot = JSON.parse(raw!).value

    expect(snapshot.chainId).to.equal(1)
    expect(snapshot.address).to.equal(YVUSD_VAULT)
    expect(snapshot.pricePerShare).to.equal(FRESH_PPS)
    expect(snapshot.asset?.symbol).to.equal('USDC')
    expect(snapshot.asset?.decimals).to.equal(6)
    expect(snapshot.tvl?.close).to.equal(9253324.98)
  })

  it('cached list payloads for rest:list:vaults contain state price & enriched asset', async function() {
    const chainRaw = await redis.get('rest:list:vaults:1')
    const allRaw = await redis.get('rest:list:vaults:all')
    expect(chainRaw).to.not.equal(null)
    expect(allRaw).to.not.equal(null)

    const chainVaults = JSON.parse(chainRaw!).value as Array<{ address: string, pricePerShare: number, asset?: { symbol?: string } }>
    const allVaults = JSON.parse(allRaw!).value as Array<{ address: string, pricePerShare: number, asset?: { symbol?: string } }>

    for (const vaults of [chainVaults, allVaults]) {
      const vault = vaults.find(item => item.address.toLowerCase() === YVUSD_VAULT.toLowerCase())
      expect(vault).to.not.equal(undefined)
      expect(vault?.pricePerShare).to.equal(1021955)
      expect(vault?.asset?.symbol).to.equal('USDC')
    }
  })

})
