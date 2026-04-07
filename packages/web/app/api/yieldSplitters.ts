import db from './db'
import chains from 'lib/chains'
import { createPublicClient, getAddress, http, type Address, type Chain, type PublicClient } from 'viem'

type TAssetLike = {
  address?: string | null
  name?: string | null
  symbol?: string | null
}

type TAddressRow = {
  chainId: number
  address: string
  asset?: TAssetLike | null
}

type TYieldSplitterLogRow = {
  chainId: number
  splitterAddress: Address
  sourceVaultAddress: Address
  sourceVaultName?: string
  sourceVaultSymbol?: string
  wantVaultAddress: Address
  wantVaultName?: string
  wantVaultSymbol?: string
}

type TYieldSplitterDynamicRow = {
  rewardHandlerAddress?: Address
  tokenizedStrategyAddress?: Address
  rewardTokenAddresses: Address[]
}

export type YieldSplitterMetadata = {
  enabled: true
  sourceVaultAddress: Address
  sourceVaultName?: string
  sourceVaultSymbol?: string
  wantVaultAddress: Address
  wantVaultName?: string
  wantVaultSymbol?: string
  depositAssetAddress?: Address
  depositAssetName?: string
  depositAssetSymbol?: string
  rewardTokenAddresses: Address[]
  rewardHandlerAddress?: Address
  tokenizedStrategyAddress?: Address
  displayType: 'Yield Splitter'
  displayKind: 'Vault-to-Vault'
  uiDescription: string
}

type TCachedYieldSplitterData = Map<string, TYieldSplitterLogRow & TYieldSplitterDynamicRow>

const YIELD_SPLITTER_ABI = [
  {
    inputs: [],
    name: 'rewardHandler',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'tokenizedStrategyAddress',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getRewardTokens',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

const CACHE_TTL_MS = 5 * 60 * 1000
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

let cachedYieldSplitters: { expiresAt: number, data: TCachedYieldSplitterData } | undefined
let cachedYieldSplittersPromise: Promise<TCachedYieldSplitterData> | undefined
const rpcClients = new Map<number, PublicClient>()

function getRpcUrl(chain: Chain): string {
  return (
    process.env[`HTTP_FULLNODE_${chain.id}`]
    || process.env[`HTTP_ARCHIVE_${chain.id}`]
    || chain.rpcUrls.default.http[0]
  )
}

function getRpcClient(chainId: number): PublicClient {
  const existing = rpcClients.get(chainId)
  if (existing) {
    return existing
  }

  const chain = chains.find((candidate) => candidate.id === chainId)
  if (!chain) {
    throw new Error(`Unknown chain id: ${chainId}`)
  }

  const client = createPublicClient({
    chain,
    transport: http(getRpcUrl(chain))
  })
  rpcClients.set(chainId, client)
  return client
}

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  try {
    return getAddress(value)
  } catch {
    return undefined
  }
}

function normalizeAddressArray(value: unknown): Address[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeAddress(item))
    .filter((item): item is Address => !!item && item !== ZERO_ADDRESS)
}

function buildYieldSplitterDescription(
  splitter: TYieldSplitterLogRow,
  asset?: TAssetLike | null
): string {
  const depositAssetLabel = asset?.symbol || asset?.name || 'the deposit asset'
  const sourceVaultLabel = splitter.sourceVaultSymbol || splitter.sourceVaultName || 'the source vault'
  const wantVaultLabel = splitter.wantVaultSymbol || splitter.wantVaultName || 'the target vault'

  return `Deposit ${depositAssetLabel}; principal is routed through ${sourceVaultLabel} and yield accrues in ${wantVaultLabel}.`
}

async function fetchYieldSplitterLogRows(): Promise<TYieldSplitterLogRow[]> {
  const result = await db.query(`
    SELECT DISTINCT
      evmlog.chain_id AS "chainId",
      evmlog.args->>'strategy' AS "splitterAddress",
      evmlog.args->>'vault' AS "sourceVaultAddress",
      COALESCE(
        source_thing.defaults->>'name',
        source_snapshot.snapshot->>'name',
        source_snapshot.hook->'meta'->>'displayName'
      ) AS "sourceVaultName",
      COALESCE(
        source_snapshot.snapshot->>'symbol',
        source_snapshot.hook->'meta'->>'displaySymbol'
      ) AS "sourceVaultSymbol",
      evmlog.args->>'want' AS "wantVaultAddress",
      COALESCE(
        want_thing.defaults->>'name',
        want_snapshot.snapshot->>'name',
        want_snapshot.hook->'meta'->>'displayName'
      ) AS "wantVaultName",
      COALESCE(
        want_snapshot.snapshot->>'symbol',
        want_snapshot.hook->'meta'->>'displaySymbol'
      ) AS "wantVaultSymbol"
    FROM evmlog
    LEFT JOIN thing AS source_thing
      ON source_thing.chain_id = evmlog.chain_id
      AND source_thing.address = evmlog.args->>'vault'
      AND source_thing.label = 'vault'
    LEFT JOIN snapshot AS source_snapshot
      ON source_snapshot.chain_id = evmlog.chain_id
      AND source_snapshot.address = evmlog.args->>'vault'
    LEFT JOIN thing AS want_thing
      ON want_thing.chain_id = evmlog.chain_id
      AND want_thing.address = evmlog.args->>'want'
      AND want_thing.label = 'vault'
    LEFT JOIN snapshot AS want_snapshot
      ON want_snapshot.chain_id = evmlog.chain_id
      AND want_snapshot.address = evmlog.args->>'want'
    WHERE evmlog.event_name = 'NewYieldSplitter'
  `)

  const mappedRows: Array<TYieldSplitterLogRow | null> = result.rows
    .map((row) => {
      const splitterAddress = normalizeAddress(row.splitterAddress)
      const sourceVaultAddress = normalizeAddress(row.sourceVaultAddress)
      const wantVaultAddress = normalizeAddress(row.wantVaultAddress)

      if (!splitterAddress || !sourceVaultAddress || !wantVaultAddress) {
        return null
      }

      return {
        chainId: Number(row.chainId),
        splitterAddress,
        sourceVaultAddress,
        sourceVaultName: typeof row.sourceVaultName === 'string' ? row.sourceVaultName : undefined,
        sourceVaultSymbol: typeof row.sourceVaultSymbol === 'string' ? row.sourceVaultSymbol : undefined,
        wantVaultAddress,
        wantVaultName: typeof row.wantVaultName === 'string' ? row.wantVaultName : undefined,
        wantVaultSymbol: typeof row.wantVaultSymbol === 'string' ? row.wantVaultSymbol : undefined
      }
    })

  return mappedRows.filter((row): row is TYieldSplitterLogRow => row !== null)
}

async function fetchYieldSplitterDynamicRows(
  splitters: TYieldSplitterLogRow[]
): Promise<Map<string, TYieldSplitterDynamicRow>> {
  const rowsByKey = new Map<string, TYieldSplitterDynamicRow>()
  const rowsByChain = splitters.reduce((accumulator, splitter) => {
    if (!accumulator.has(splitter.chainId)) {
      accumulator.set(splitter.chainId, [])
    }
    accumulator.get(splitter.chainId)?.push(splitter)
    return accumulator
  }, new Map<number, TYieldSplitterLogRow[]>())

  await Promise.all(
    Array.from(rowsByChain.entries()).map(async ([chainId, chainSplitters]) => {
      const client = getRpcClient(chainId)
      const contracts = chainSplitters.flatMap((splitter) => [
        {
          address: splitter.splitterAddress,
          abi: YIELD_SPLITTER_ABI,
          functionName: 'rewardHandler' as const
        },
        {
          address: splitter.splitterAddress,
          abi: YIELD_SPLITTER_ABI,
          functionName: 'tokenizedStrategyAddress' as const
        },
        {
          address: splitter.splitterAddress,
          abi: YIELD_SPLITTER_ABI,
          functionName: 'getRewardTokens' as const
        }
      ])

      const results = await client.multicall({
        contracts,
        allowFailure: true
      })

      chainSplitters.forEach((splitter, index) => {
        const rewardHandler = results[index * 3]
        const tokenizedStrategy = results[index * 3 + 1]
        const rewardTokens = results[index * 3 + 2]
        const splitterKey = `${splitter.chainId}:${splitter.splitterAddress.toLowerCase()}`

        rowsByKey.set(splitterKey, {
          rewardHandlerAddress:
            rewardHandler?.status === 'success' ? normalizeAddress(rewardHandler.result) : undefined,
          tokenizedStrategyAddress:
            tokenizedStrategy?.status === 'success' ? normalizeAddress(tokenizedStrategy.result) : undefined,
          rewardTokenAddresses:
            rewardTokens?.status === 'success' ? normalizeAddressArray(rewardTokens.result) : []
        })
      })
    })
  )

  return rowsByKey
}

async function loadYieldSplitterData(): Promise<TCachedYieldSplitterData> {
  const logRows = await fetchYieldSplitterLogRows()
  if (logRows.length === 0) {
    return new Map()
  }

  const dynamicRows = await fetchYieldSplitterDynamicRows(logRows)
  return logRows.reduce((accumulator, row) => {
    const key = `${row.chainId}:${row.splitterAddress.toLowerCase()}`
    accumulator.set(key, {
      ...row,
      ...(dynamicRows.get(key) ?? {
        rewardTokenAddresses: []
      })
    })
    return accumulator
  }, new Map<string, TYieldSplitterLogRow & TYieldSplitterDynamicRow>())
}

async function getYieldSplitterData(): Promise<TCachedYieldSplitterData> {
  const now = Date.now()
  if (cachedYieldSplitters && cachedYieldSplitters.expiresAt > now) {
    return cachedYieldSplitters.data
  }

  if (!cachedYieldSplittersPromise) {
    cachedYieldSplittersPromise = loadYieldSplitterData()
      .then((data) => {
        cachedYieldSplitters = {
          expiresAt: Date.now() + CACHE_TTL_MS,
          data
        }
        return data
      })
      .finally(() => {
        cachedYieldSplittersPromise = undefined
      })
  }

  return cachedYieldSplittersPromise
}

function attachYieldSplitterRow<T extends TAddressRow>(
  row: T,
  yieldSplitters: TCachedYieldSplitterData
): T & { yieldSplitter?: YieldSplitterMetadata } {
  const key = `${row.chainId}:${row.address.toLowerCase()}`
  const splitter = yieldSplitters.get(key)
  if (!splitter) {
    return row
  }

  const depositAssetAddress = normalizeAddress(row.asset?.address)
  const yieldSplitter: YieldSplitterMetadata = {
    enabled: true,
    sourceVaultAddress: splitter.sourceVaultAddress,
    sourceVaultName: splitter.sourceVaultName,
    sourceVaultSymbol: splitter.sourceVaultSymbol,
    wantVaultAddress: splitter.wantVaultAddress,
    wantVaultName: splitter.wantVaultName,
    wantVaultSymbol: splitter.wantVaultSymbol,
    depositAssetAddress,
    depositAssetName: row.asset?.name ?? undefined,
    depositAssetSymbol: row.asset?.symbol ?? undefined,
    rewardTokenAddresses: splitter.rewardTokenAddresses,
    rewardHandlerAddress: splitter.rewardHandlerAddress,
    tokenizedStrategyAddress: splitter.tokenizedStrategyAddress,
    displayType: 'Yield Splitter',
    displayKind: 'Vault-to-Vault',
    uiDescription: buildYieldSplitterDescription(splitter, row.asset)
  }

  return {
    ...row,
    yieldSplitter
  }
}

export async function attachYieldSplitterMetadata<T extends TAddressRow>(
  rows: T[]
): Promise<Array<T & { yieldSplitter?: YieldSplitterMetadata }>> {
  if (rows.length === 0) {
    return []
  }

  const yieldSplitters = await getYieldSplitterData()
  return rows.map((row) => attachYieldSplitterRow(row, yieldSplitters))
}

export async function attachYieldSplitterMetadataToRow<T extends TAddressRow>(
  row: T
): Promise<T & { yieldSplitter?: YieldSplitterMetadata }> {
  const yieldSplitters = await getYieldSplitterData()
  return attachYieldSplitterRow(row, yieldSplitters)
}
