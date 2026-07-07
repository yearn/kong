import 'lib/global'

import db from 'ingest/db'
import { promoteTempTable } from '../backfill-shared/upsert'

/**
 * Phase 2: Promote the staged apr-oracle current* components from the temp
 * table into the production output table. Run compute.ts first.
 */

const TEMP_TABLE = 'output_temp_apr_oracle_current_backfill'

async function main() {
  try {
    await promoteTempTable(TEMP_TABLE)
  } finally {
    await db.end()
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
