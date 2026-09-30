import 'lib/global'
import { abisConfig, mq } from 'lib'
import db, { getTravelledStrides } from 'ingest/db'
import { findBusyMatch } from 'ingest/fanout/isBusy'
import { toEventSelector } from 'viem'

const CHAIN_ID = 1
const VAULTS = [
  { name: 'BTC yVault', address: '0xF9e2bB1C632CD55806bF283aC8A51d37DB9D010B', knownAdd: 25490630n },
  { name: 'Curve USG-frxUSD yVault', address: '0x0eD92e4225126578791303BF579F2853e7Fdca6B', knownAdd: 25341800n },
  { name: 'ETH yVault', address: '0xf632554A9B23ce6E1EA314c9640E831170015f77', knownAdd: 25475622n }
]
const STRATEGY_CHANGED = toEventSelector('event StrategyChanged(address indexed strategy, uint256 change_type)')
const apply = process.argv.includes('--apply')

async function inspect(vault: typeof VAULTS[number]) {
  const thing = (await db.query(
    `SELECT address, defaults->>'inceptBlock' AS "inceptBlock", defaults->>'yearn' AS yearn
     FROM thing WHERE chain_id = $1 AND label = 'vault' AND lower(address) = lower($2)`,
    [CHAIN_ID, vault.address]
  )).rows[0]
  if (!thing) throw new Error(`!thing ${vault.address}`)
  const address = thing.address as `0x${string}`
  const strides = (await getTravelledStrides(CHAIN_ID, address, [STRATEGY_CHANGED]))[STRATEGY_CHANGED]
  const events = (await db.query(
    `SELECT block_number AS "blockNumber", args->>'strategy' AS strategy, args->>'change_type' AS "changeType"
     FROM evmlog WHERE chain_id = $1 AND address = $2 AND signature = $3
     ORDER BY block_number, log_index`,
    [CHAIN_ID, address, STRATEGY_CHANGED]
  )).rows
  const knownAddPresent = events.some(e => BigInt(e.blockNumber) === vault.knownAdd)
  return { ...vault, address, inceptBlock: BigInt(thing.inceptBlock), yearn: thing.yearn, strides, events, knownAddPresent }
}

async function main() {
  const abi = abisConfig.abis.find(a => a.abiPath === 'yearn/3/vault')
  if (!abi) throw new Error('!yearn/3/vault abi')

  const states = []
  for (const vault of VAULTS) states.push(await inspect(vault))
  console.log(JSON.stringify({ at: new Date().toISOString(), chainId: CHAIN_ID, vaults: states }, null, 2))

  const busy = await findBusyMatch()
  const fanoutQueue = mq.connect(abisConfig.cron.queue)
  const cronScheduled = (await fanoutQueue.getRepeatableJobs()).some(j => j.name === abisConfig.cron.job)
  const abiFanoutPending = (await fanoutQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized']))
    .some(j => j.name === abisConfig.cron.job)
  await fanoutQueue.close()
  console.log(JSON.stringify({ busy, abiFanoutCronScheduled: cronScheduled, abiFanoutPending }))

  if (!apply) return
  if (busy) throw new Error('abort: ingestion busy')
  if (cronScheduled) throw new Error('abort: AbiFanout cron still scheduled')
  if (abiFanoutPending) throw new Error('abort: AbiFanout job waiting or active')

  for (const state of states) {
    const deleted = await db.query(
      'DELETE FROM evmlog_strides WHERE chain_id = $1 AND address = $2',
      [CHAIN_ID, state.address]
    )
    console.log('⏪', state.name, state.address, JSON.stringify({ deleted: deleted.rowCount }))

    await mq.add(mq.job.fanout.events, {
      chainId: CHAIN_ID,
      readers: [{ abi, source: { chainId: CHAIN_ID, address: state.address, inceptBlock: state.inceptBlock } }]
    })
    console.log('📤', 'fanout.events yearn/3/vault', state.address, 'from', state.inceptBlock)
  }
}

main()
  .catch(error => { console.error('🤬', error); process.exitCode = 1 })
  .finally(async () => { await mq.down(); await db.end() })
