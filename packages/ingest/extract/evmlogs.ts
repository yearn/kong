import { z } from 'zod'
import { rpcs } from '../rpcs'
import { math, mq } from 'lib'
import { EvmAddress, EvmAddressSchema, EvmLogSchema, zhexstring } from 'lib/types'
import { getBlockTime, getDefaultStartBlockNumber } from 'lib/blocks'
import { getAddress, toEventSelector } from 'viem'
import db from '../db'
import { ResolveHooks } from '../abis/types'
import { requireHooks } from '../abis'
import abiutil from '../abiutil'
import blacklist from 'lib/blacklist'
import { safeFetchOrExtractDecimals } from '../abis/yearn/lib'
import { EnvioLagError, fetchEnvioLogs, invalidateEnvioSource, isEnvioSourceTrusted, partitionEnvioEvents } from '../envio'

export class EvmLogsExtractor {
  resolveHooks: ResolveHooks|undefined

  async extract(data: object) {
    if (!this.resolveHooks) this.resolveHooks = await requireHooks()

    const { abiPath, chainId, address, from, to, replay } = z.object({
      abiPath: z.string(),
      chainId: z.number(),
      address: zhexstring,
      from: z.bigint({ coerce: true }),
      to: z.bigint({ coerce: true }),
      replay: z.boolean().optional()
    }).parse(data)

    const abi = await abiutil.load(abiPath)
    const defaultStartBlockNumber = await getDefaultStartBlockNumber(chainId)
    const excludeLimitlist = from < defaultStartBlockNumber

    const events = excludeLimitlist
      ? abiutil.exclude([...blacklist.events.ignore, ...blacklist.events.limit], abiutil.events(abi))
      : abiutil.exclude(blacklist.events.ignore, abiutil.events(abi))

    const logs = await (async () => {
      if (replay) {
        return await fetchLogs(chainId, address, from, to)
      } else if (await isEnvioSourceTrusted(chainId, address, abiPath, from)) {
        const { mapped, unmapped } = partitionEnvioEvents(abiPath, events)
        let envioLogs: Awaited<ReturnType<typeof fetchEnvioLogs>>
        try {
          envioLogs = await fetchEnvioLogs(chainId, address, from, to, mapped, abiPath)
        } catch (error) {
          if (error instanceof EnvioLagError) {
            console.info('ENVIO_LAG_RPC', { chainId, address, abiPath, from: String(from), to: String(to), progress: String(error.progress) })
          } else {
            console.warn('ENVIO_RPC_FALLBACK', { chainId, address, abiPath, from: String(from), to: String(to), phase: 'extract', error })
          }
          return await rpcs.next(chainId, from).getLogs({ address, events, fromBlock: from, toBlock: to })
        }
        // Entity coverage is narrower than an ABI. Never credit missing events
        // as fetched, and verify empty entity results against RPC.
        const present = new Set(envioLogs.map(log => log.topics[0]))
        const emptyMapped = mapped.map(event => ({ event, signature: toEventSelector(event) })).filter(({ signature }) => !present.has(signature))
        const emptySignatures = new Set(emptyMapped.map(({ signature }) => signature))
        const rpcEvents = [...unmapped, ...emptyMapped.map(({ event }) => event)]
        const rpcLogs = rpcEvents.length ? await rpcs.next(chainId, from).getLogs({
          address, events: rpcEvents, fromBlock: from, toBlock: to
        }) : []
        if (emptyMapped.length && rpcLogs.some(log => log.topics[0] !== undefined && emptySignatures.has(log.topics[0]))) {
          await invalidateEnvioSource(chainId, address, abiPath)
          console.warn('ENVIO_EMPTY_RPC_MISMATCH', { chainId, address, abiPath, from: String(from), to: String(to) })
        }
        return [...envioLogs, ...rpcLogs].sort((a, b) =>
          Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0))
      } else {
        return await rpcs.next(chainId, from).getLogs({
          address,
          events,
          fromBlock: BigInt(from),
          toBlock: BigInt(to)
        })
      }
    })()

    const hooks = this.resolveHooks(abiPath, 'event')
    const processedLogs: any[] = []
    for (const log of logs) {
      if(!log.topics[0]) { throw new Error('!log.topics[0]') }

      const args = extractLogArgs(log)
      if (await tooSmall(chainId, address, args)) {
        console.log('❌', 'too small', chainId, log.transactionHash)
        continue
      }

      const blacklisted = containsBlacklistedAddress(chainId, args)
      if (blacklisted.result) {
        console.log('🏴‍☠️', 'blacklisted', blacklisted.address)
        continue
      }

      const blockTime = ('blockTime' in log ? log.blockTime : undefined) ?? await getBlockTime(chainId, log.blockNumber || undefined)
      const hookLog = { ...log, blockTime }
      const topic = log.topics[0]
      const topical = hooks.filter(h => h.module.topics && h.module.topics.includes(topic))

      let hookResult = {}
      for (const hook of topical) {
        hookResult = {
          ...hookResult,
          ...await hook.module.default(chainId, address, hookLog)
        }
      }

      processedLogs.push({
        ...log,
        chainId,
        address: getAddress(log.address),
        signature: log.topics[0],
        args,
        hook: hookResult,
        blockTime
      })
    }

    try {
      await mq.add(mq.job.load.evmlog, {
        chainId, address, from, to,
        batch: EvmLogSchema.array().parse(processedLogs)
      }, {
        priority: mq.LOWEST_PRIORITY
      })
    } catch (error) {
      console.log('--------')
      console.log()
      console.log(processedLogs)
      console.log()
      console.log('--------')
      throw error
    }
  }
}

export function containsBlacklistedAddress(chainId: number, args: any) {
  for (const value of Object.values(args)) {
    try {
      const parse = EvmAddressSchema.safeParse(value)
      if (!parse.success) continue
      if (blacklist.addresses.some(a => a.chainId === chainId && getAddress(a.address) === getAddress(parse.data))) {
        return { result: true, address: parse.data }
      }
    } catch (error) {
      continue
    }
  }
  return { result: false, address: undefined }
}

export async function tooSmall(chainId: number, address: EvmAddress, args: any) {
  const { success, decimals } = await safeFetchOrExtractDecimals(chainId, address)
  if (!success) return false
  const amount =  args.value ?? args.assets ?? args.amount
  if (amount === undefined) return false
  return math.div(BigInt(amount), 10n ** BigInt(decimals)) < 0.1
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractLogArgs(log: any) {
  if (!log.args) return {}
  if (Array.isArray(log.args)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return log.args.reduce((acc: any, arg: any, i: number) => {
      acc[`arg${i}`] = arg
      return acc
    }, {})
  } else {
    return log.args
  }
}

async function fetchLogs(chainId: number, address: `0x${string}`, from: bigint, to: bigint, eventName?: string) {
  const result = await db.query(`
    SELECT
      chain_id as "chainId",
      address,
      event_name as "eventName",
      signature,
      topics,
      args,
      hook,
      block_number as "blockNumber",
      block_time as "blockTime",
      log_index as "logIndex",
      transaction_hash as "transactionHash",
      transaction_index as "transactionIndex"
    FROM evmlog
    WHERE
      chain_id = $1
      AND address = $2
      AND block_number >= $3
      AND block_number <= $4
      AND (event_name = $5 OR $5 IS NULL)
  `, [chainId, address, from, to, eventName])
  return EvmLogSchema.array().parse(result.rows)
}
