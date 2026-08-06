const DAY_SECONDS = 86_400
const MAX_ADDRESSES = 50
const MAX_RANGE_YEARS = 10
const MAX_CHAIN_ID = 2_147_483_647
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const QUALIFIED_ADDRESS_PATTERN = /^([1-9][0-9]*):(0x[0-9a-fA-F]{40})$/
const REQUEST_FIELDS = new Set(['start', 'finish', 'addresses'])

export type PpsAddress = {
  key: string
  chainId: number
  address: string
}

export type PpsBatchRequest = {
  start: number
  finish: number
  addresses: PpsAddress[]
}

export type PpsPoint = {
  time: number
  value: string
}

export type PpsBatchResponse = Record<string, PpsPoint[]>

export type ParsePpsBatchRequestResult =
  | { success: true; data: PpsBatchRequest }
  | { success: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUtcDayTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value % DAY_SECONDS === 0
}

function isWithinRangeLimit(start: number, finish: number): boolean {
  const startDate = new Date(start * 1_000)
  if (!Number.isFinite(startDate.getTime())) return false

  const targetYear = startDate.getUTCFullYear() + MAX_RANGE_YEARS
  const targetMonth = startDate.getUTCMonth()
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(startDate.getUTCDate(), lastTargetDay)
  const maximumFinish = Date.UTC(targetYear, targetMonth, targetDay) / 1_000

  return finish <= maximumFinish
}

function parseQualifiedAddress(value: unknown): PpsAddress | undefined {
  if (typeof value !== 'string') return undefined

  const match = QUALIFIED_ADDRESS_PATTERN.exec(value)
  if (!match) return undefined

  const chainId = Number(match[1])
  const address = match[2].toLowerCase()

  if (
    !Number.isSafeInteger(chainId) ||
    chainId <= 0 ||
    chainId > MAX_CHAIN_ID ||
    !ADDRESS_PATTERN.test(address)
  ) {
    return undefined
  }

  return {
    key: `${chainId}:${address}`,
    chainId,
    address,
  }
}

export function parsePpsBatchRequest(input: unknown): ParsePpsBatchRequestResult {
  if (!isRecord(input)) {
    return { success: false, error: 'Request body must be a JSON object' }
  }

  const fields = Object.keys(input)
  if (fields.length !== REQUEST_FIELDS.size || fields.some((field) => !REQUEST_FIELDS.has(field))) {
    return { success: false, error: 'Request body must contain only start, finish, and addresses' }
  }

  if (!isUtcDayTimestamp(input.start) || !isUtcDayTimestamp(input.finish)) {
    return {
      success: false,
      error: 'start and finish must be non-negative UTC-day Unix timestamps',
    }
  }

  if (input.start > input.finish) {
    return { success: false, error: 'start must be less than or equal to finish' }
  }

  if (!isWithinRangeLimit(input.start, input.finish)) {
    return { success: false, error: 'Requested range must not exceed 10 years' }
  }

  if (!Array.isArray(input.addresses) || input.addresses.length === 0) {
    return { success: false, error: 'addresses must contain at least one item' }
  }

  if (input.addresses.length > MAX_ADDRESSES) {
    return { success: false, error: `addresses must contain at most ${MAX_ADDRESSES} items` }
  }

  const parsedAddresses = input.addresses.map(parseQualifiedAddress)
  if (parsedAddresses.some((address) => address === undefined)) {
    return {
      success: false,
      error: 'Each address must use the format <chainId>:<0x-address>',
    }
  }

  const addresses = Array.from(
    new Map(
      (parsedAddresses as PpsAddress[]).map((address) => [address.key, address]),
    ).values(),
  )

  return {
    success: true,
    data: {
      start: input.start,
      finish: input.finish,
      addresses,
    },
  }
}
