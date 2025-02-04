import { parseAbi, toEventSelector } from 'viem'
import { rpcs } from '../../../../../rpcs'
import { Tradeable, TradeableSchema, zhexstring } from 'lib/types'
import db from '../../../../../db'
import { throwOnMulticallError } from '../../../lib'

export default async function process(chainId: number, address: `0x${string}`, data: any) {
  const tradeables = await fill(chainId, await project(chainId, address))
  return { tradeables }
}

async function project(chainId: number, tradeHandler: `0x${string}`) {
  const topics = [
    toEventSelector('event TradeEnabled(address indexed seller, address indexed tokenIn, address indexed tokenOut)'),
    toEventSelector('event TradeDisabled(address indexed seller, address indexed tokenIn, address indexed tokenOut)')
  ]

  const events = await db.query(`
  SELECT signature, args
  FROM evmlog
  WHERE chain_id = $1 AND address = $2 AND signature = ANY($3)
  ORDER BY block_number ASC, log_index ASC`,
  [chainId, tradeHandler, topics])
  if(events.rows.length === 0) return []

  const result: Partial<Tradeable>[] = []

  for (const event of events.rows) {
    const index = result.findIndex(r => r.strategy === zhexstring.parse(event.args.seller) && r.token === zhexstring.parse(event.args.tokenIn))
    switch (event.signature) {
    case topics[0]:
      if (index > -1) break
      result.push({
        strategy: zhexstring.parse(event.args.seller),
        token: zhexstring.parse(event.args.tokenIn)
      })
      break
    case topics[1]:
      if (index !== -1) result.splice(index, 1)
      break
    }
  }

  return result
}

async function fill(chainId: number, tradeables: Partial<Tradeable>[]) {
  const contracts = tradeables.map(t => [
    { address: t.token!, functionName: 'name', abi: parseAbi(['function name() view returns (string)']) },
    { address: t.token!, functionName: 'symbol', abi: parseAbi(['function symbol() view returns (string)']) },
    { address: t.token!, functionName: 'decimals', abi: parseAbi(['function decimals() view returns (uint256)']) },
  ]).flat()

  const multicall = await rpcs.next(chainId).multicall({ contracts })
  throwOnMulticallError(multicall)

  return tradeables.map((t, i) => TradeableSchema.parse({
    ...t,
    name: multicall[i * 3].result,
    symbol: multicall[i * 3 + 1].result,
    decimals: multicall[i * 3 + 2].result
  }))
}
