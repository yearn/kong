import 'lib/global'
import { getAddress } from 'viem'
import { z } from 'zod'
import db from './db'
import { rpcs } from './rpcs'
import { updateSnapshotAllocator } from './allocator-store'
import { projectCurrentAllocator } from './allocators'

function option(name: string) {
  return process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

const chainId = Number(option('chain'))
if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('--chain must be a positive chain ID configured in Kong')
const vault = option('vault')
const write = process.argv.includes('--write')

async function run() {
  try {
    await rpcs.up()
    const result = await db.query(`
    SELECT snapshot.address, snapshot.hook
    FROM snapshot JOIN thing ON thing.chain_id = snapshot.chain_id AND thing.address = snapshot.address
    WHERE thing.chain_id = $1 AND thing.label = 'vault'
      AND COALESCE(snapshot.snapshot->>'apiVersion', thing.defaults->>'apiVersion', '') LIKE '3.%'
      AND ($2::text IS NULL OR thing.address = $2)
    ORDER BY thing.address`, [chainId, vault ? getAddress(vault) : null])
    for (const row of result.rows) {
      const strategies = z.array(z.string().regex(/^0x[\da-fA-F]{40}$/)).parse(row.hook?.strategies ?? [])
        .map(address => getAddress(address))
      const projection = await projectCurrentAllocator(chainId, getAddress(row.address), strategies, rpcs.next(chainId, 0n))
      if (projection.revision === null) {
        console.error(JSON.stringify({ chainId, vault: row.address, status: projection.status, reason: projection.reason }))
        process.exitCode = 1
        continue
      }
      const update = write ? await updateSnapshotAllocator(chainId, getAddress(row.address), projection) : null
      const reported = update?.projection ?? projection
      const outcome = update ? (update.applied ? 'applied' : 'skipped') : 'dry_run'
      console.log(JSON.stringify({ chainId, vault: row.address, address: reported.address, support: reported.support,
        revision: reported.revision, asOfBlock: reported.asOfBlock, outcome, written: update?.applied ?? false }))
    }
    if (result.rows.length === 0) throw new Error('No matching V3 vault snapshots')
  } finally {
    await rpcs.down()
    await db.end()
  }

}

run().catch(() => { console.error('Allocator refresh failed'); process.exitCode = 1 })
