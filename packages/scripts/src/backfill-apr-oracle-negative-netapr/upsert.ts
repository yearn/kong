import 'lib/global'

import db from 'ingest/db'
import { mq } from 'lib'
import { parsePromoteArgs, promoteTempTable } from '../backfill-shared/upsert'

/**
 * Phase 2: Promote floored netApr/netApy outputs from the temp table into the
 * production output table. Run compute.ts first.
 */

const TEMP_TABLE = 'output_temp_netapr_floor_backfill'
const SCRIPT_PATH = 'packages/scripts/src/backfill-apr-oracle-negative-netapr/upsert.ts'

async function main() {
  const options = parsePromoteArgs(process.argv.slice(2), SCRIPT_PATH, TEMP_TABLE)
  try {
    await promoteTempTable(TEMP_TABLE, options)
  } finally {
    await mq.down()
    await db.end()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
