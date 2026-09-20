import { cache } from 'lib/cache'
import { EvmLog, EvmLogSchema } from 'lib/types'
import { encodeEventTopics, getAddress } from 'viem'

const ENVIO_ALIASES: Record<string, string> = {
  StrategyReportedLegacy: 'StrategyReported',
  StrategyAddedLegacy: 'StrategyAdded'
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
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': process.env.ENVIO_HASURA_ADMIN_SECRET || ''
    },
    body: JSON.stringify({ query, variables })
  })
  if (!response.ok) throw new Error(`Envio GraphQL request failed: ${response.status}`)
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
  abi: readonly any[],
  events: readonly any[]
): Promise<EvmLog[]> {
  const names = [...new Set([
    ...events.map(event => event.name),
    ...Object.keys(ENVIO_ALIASES).filter(name => events.some(event => event.name === ENVIO_ALIASES[name]))
  ])]
  const query = `query ($chainId: Int!, $address: String!, $from: Int!, $to: Int!, $names: [String!]!, $offset: Int!) {
    raw_events(
      where: {
        chain_id: { _eq: $chainId }
        src_address: { _eq: $address }
        block_number: { _gte: $from, _lte: $to }
        event_name: { _in: $names }
      }
      order_by: [{ block_number: asc }, { log_index: asc }]
      limit: ${ENVIO_PAGE_SIZE}
      offset: $offset
    ) {
      event_name block_number log_index src_address block_timestamp transaction_fields params
    }
  }`
  const rows: any[] = []
  for (let offset = 0; ; offset += ENVIO_PAGE_SIZE) {
    const response = await gql(query, {
      chainId,
      address: address.toLowerCase(),
      from: Number(from),
      to: Number(to),
      names,
      offset
    })
    const page = response.data?.raw_events || []
    rows.push(...page)
    if (page.length < ENVIO_PAGE_SIZE) break
  }
  return rows.map(row => mapEnvioRow(row, abi, chainId))
}

export function mapEnvioRow(row: any, abi: readonly any[], chainId: number): EvmLog {
  const eventName = ENVIO_ALIASES[row.event_name] ?? row.event_name
  const candidates = abi.filter(event => event.type === 'event' && event.name === eventName)
  const paramNames = new Set(Object.keys(row.params || {}))
  const event = candidates.find(candidate => {
    const inputNames = new Set(candidate.inputs.map((input: any) => input.name))
    return inputNames.size === paramNames.size && [...inputNames].every(name => paramNames.has(name))
  })
  if (!event) throw new Error(`Envio event ABI not found for ${row.event_name}`)

  const args = Object.fromEntries(event.inputs.map((input: any) => [input.name, coerceValue(row.params[input.name], input.type)]))
  const indexedArgs = Object.fromEntries(event.inputs
    .filter((input: any) => input.indexed)
    .map((input: any) => [input.name, args[input.name]]))
  const topics = encodeEventTopics({ abi: [event], eventName, args: indexedArgs } as any)

  return EvmLogSchema.parse({
    chainId,
    address: getAddress(row.src_address),
    eventName,
    signature: topics[0],
    topics,
    args,
    hook: {},
    blockNumber: BigInt(row.block_number),
    blockTime: BigInt(row.block_timestamp),
    logIndex: row.log_index,
    transactionHash: row.transaction_fields.hash,
    transactionIndex: row.transaction_fields.transactionIndex
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
