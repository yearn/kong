import { cache } from 'lib/cache'
import { EvmLog, EvmLogSchema } from 'lib/types'
import { encodeEventTopics, getAddress } from 'viem'

const ENVIO_ENTITIES: Record<string, { entity: string, address: string, has?: string, lacks?: string }> = {
  'yearn/2/registry:NewVault': { entity: 'V2RegistryNewVault', address: 'registryAddress' },
  'yearn/2/registry:NewExperimentalVault': { entity: 'V2RegistryNewExperimentalVault', address: 'registryAddress' },
  'yearn/2/registry2:NewVault': { entity: 'V2Registry2NewVault', address: 'registryAddress' },
  'yearn/2/strategy:Harvested': { entity: 'V2StrategyHarvested', address: 'strategyAddress' },
  'yearn/2/vault:StrategyAdded': { entity: 'V2StrategyAdded', address: 'vaultAddress', has: 'minDebtPerHarvest' },
  'yearn/2/vault:StrategyAdded:legacy': { entity: 'V2StrategyAdded', address: 'vaultAddress', has: 'rateLimit' },
  'yearn/2/vault:StrategyMigrated': { entity: 'V2StrategyMigrated', address: 'vaultAddress' },
  'yearn/2/vault:StrategyReported': { entity: 'V2StrategyReported', address: 'vaultAddress', has: 'debtPaid' },
  'yearn/2/vault:StrategyReported:legacy': { entity: 'V2StrategyReported', address: 'vaultAddress', lacks: 'debtPaid' },
  'yearn/2/vault:StrategyRevoked': { entity: 'V2StrategyRevoked', address: 'vaultAddress' },
  'yearn/2/vault:Transfer': { entity: 'Transfer', address: 'vaultAddress' },
  'yearn/3/debtManagerFactory:NewDebtAllocator': { entity: 'NewDebtAllocator', address: 'factoryAddress' },
  'yearn/3/registry:NewEndorsedVault': { entity: 'V3RegistryNewEndorsedVault', address: 'registryAddress' },
  'yearn/3/registry2:NewEndorsedVault': { entity: 'V3RegistryNewEndorsedVault', address: 'registryAddress' },
  'yearn/3/registry3:NewEndorsedVault': { entity: 'V3RegistryNewEndorsedVault', address: 'registryAddress' },
  'yearn/3/roleManager:AddedNewVault': { entity: 'V3RoleManagerAddedNewVault', address: 'roleManagerAddress' },
  'yearn/3/roleManagerFactory:NewProject': { entity: 'V3RoleManagerFactoryNewProject', address: 'factoryAddress' },
  'yearn/3/splitter/factory:NewSplitter': { entity: 'V3SplitterNewSplitter', address: 'factoryAddress' },
  'yearn/3/yieldSplitter/factory:NewYieldSplitter': { entity: 'V3YieldSplitterNewYieldSplitter', address: 'factoryAddress' },
  'yearn/3/strategy:Reported': { entity: 'V3StrategyReported', address: 'strategyAddress' },
  'yearn/3/vault:StrategyChanged': { entity: 'StrategyChanged', address: 'vaultAddress' },
  'yearn/3/vault:StrategyReported': { entity: 'StrategyReported', address: 'vaultAddress' },
  'yearn/3/vault:Transfer': { entity: 'Transfer', address: 'vaultAddress' },
  'yearn/3/vault:Deposit': { entity: 'Deposit', address: 'vaultAddress' },
  'yearn/3/vaultFactory:NewVault': { entity: 'V3VaultFactoryNewVault', address: 'factoryAddress' },
  'yearn/governance/votingEscrow:VestingEscrowCreated': { entity: 'VotingEscrowCreated', address: 'factoryAddress' },
  'yearn/staking/registry/juiced:StakingPoolAdded': { entity: 'StakingPoolAdded', address: 'registryAddress' },
  'yearn/staking/registry/opboost:StakingPoolAdded': { entity: 'StakingPoolAdded', address: 'registryAddress' },
  'yearn/staking/registry/v3:StakingPoolAdded': { entity: 'StakingPoolAdded', address: 'registryAddress' },
  'yearn/staking/registry/veyfi:Register': { entity: 'VeyfiGaugeRegistered', address: 'registryAddress' }
}

const ENVIO_PAGE_SIZE = 1000

export function useEnvio(chainId: number): boolean {
  if ((process.env.USE_ENVIO || '').trim().toLowerCase() !== 'true') return false
  return (process.env.ENVIO_CHAINS || '')
    .split(',')
    .map(value => Number(value.trim()))
    .includes(chainId)
}

async function gql(query: string, variables?: Record<string, unknown>): Promise<any> {
  const response = await fetch(process.env.ENVIO_GRAPHQL_URL || '', {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': process.env.ENVIO_HASURA_ADMIN_SECRET || ''
    },
    body: JSON.stringify({ query, variables })
  })
  if (!response.ok) throw new Error(`Envio GraphQL request failed: ${response.status} ${await response.text()}`)
  const result = await response.json()
  if (result.errors?.length) {
    throw new Error(result.errors.map((error: any) => error.message || String(error)).join('; '))
  }
  return result
}

export async function envioProgressBlock(chainId: number): Promise<bigint> {
  const result = await cache.wrap(`envioProgressBlock:${chainId}`, async () => {
    const response = await gql('{ _meta { chainId progressBlock } }')
    const entries = Array.isArray(response.data?._meta) ? response.data._meta : [response.data?._meta]
    const entry = entries.find((value: any) => Number(value?.chainId) === chainId)
    if (!entry || entry.progressBlock === undefined || entry.progressBlock === null) {
      throw new Error(`Envio progress block missing for chain ${chainId}`)
    }
    return String(entry.progressBlock)
  }, 30_000)
  return BigInt(result)
}

export async function fetchEnvioLogs(
  chainId: number,
  address: `0x${string}`,
  from: bigint,
  to: bigint,
  events: readonly any[],
  abiPath: string
): Promise<EvmLog[]> {
  const progress = await envioProgressBlock(chainId)
  if (to > progress) throw new Error(`Envio behind for chain ${chainId}: to ${to} > progress ${progress}`)

  const logs: EvmLog[] = []
  for (const [key, { entity, address: addressField, has, lacks }] of Object.entries(ENVIO_ENTITIES)) {
    const [path, eventName] = key.split(':')
    if (path !== abiPath) continue
    const event = events.find(e => e.name === eventName
      && (!has || e.inputs.some((input: any) => input.name === has))
      && (!lacks || !e.inputs.some((input: any) => input.name === lacks)))
    if (!event) continue

    const query = `query ($chainId: Int!, $address: String!, $to: Int!, $block: Int!, $logIndex: Int!) {
      ${entity}(
        where: {
          chainId: { _eq: $chainId }
          ${addressField}: { _eq: $address }
          blockNumber: { _lte: $to }
          ${has ? `${has}: { _is_null: false }` : ''}
          ${lacks ? `${lacks}: { _is_null: true }` : ''}
          _or: [
            { blockNumber: { _gt: $block } }
            { blockNumber: { _eq: $block }, logIndex: { _gt: $logIndex } }
          ]
        }
        order_by: [{ blockNumber: asc }, { logIndex: asc }]
        limit: ${ENVIO_PAGE_SIZE}
      ) {
        blockNumber blockTimestamp transactionHash transactionIndex logIndex ${event.inputs.map((input: any) => input.name).join(' ')}
      }
    }`
    let cursor = { block: Number(from), logIndex: -1 }
    for (;;) {
      const response = await gql(query, { chainId, address: getAddress(address), to: Number(to), ...cursor })
      const page: any[] = response.data?.[entity] || []
      logs.push(...page.map(row => mapEnvioRow(row, event, chainId, address)))
      if (page.length < ENVIO_PAGE_SIZE) break
      const last = page[page.length - 1]
      cursor = { block: Number(last.blockNumber), logIndex: Number(last.logIndex) }
    }
  }
  return logs.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)
}

export function mapEnvioRow(row: any, event: any, chainId: number, address: `0x${string}`): EvmLog {
  if (!row.transactionHash || row.transactionIndex === undefined || row.transactionIndex === null) {
    throw new Error(`Envio row missing tx fields: ${event.name} ${chainId} ${address} ${row.blockNumber}:${row.logIndex}`)
  }
  const args = Object.fromEntries(event.inputs.map((input: any) => [input.name, coerceValue(row[input.name], input.type)]))
  const indexedArgs = Object.fromEntries(event.inputs
    .filter((input: any) => input.indexed)
    .map((input: any) => [input.name, args[input.name]]))
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args: indexedArgs } as any)

  return EvmLogSchema.parse({
    chainId,
    address: getAddress(address),
    eventName: event.name,
    signature: topics[0],
    topics,
    args,
    hook: {},
    blockNumber: BigInt(row.blockNumber),
    blockTime: BigInt(row.blockTimestamp),
    logIndex: row.logIndex,
    transactionHash: row.transactionHash,
    transactionIndex: row.transactionIndex
  })
}

function coerceValue(value: any, type: string): any {
  const array = type.endsWith(']')
  const elementType = array ? type.slice(0, type.lastIndexOf('[')) : type
  if (array) return value.map((item: any) => coerceValue(item, elementType))
  if (/^u?int/.test(type)) return BigInt(value)
  if (type === 'address') return getAddress(value)
  return value
}
