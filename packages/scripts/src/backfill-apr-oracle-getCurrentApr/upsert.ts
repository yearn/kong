import 'lib/global'

import db from 'ingest/db'
import { promoteTempTable } from '../backfill-shared/upsert'

/**
 * Phase 2: Promote computed apr-oracle outputs from the temp table into the
 * production output table. Run compute.ts first.
 */

const TEMP_TABLE = 'output_temp_apr_oracle_backfill'

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
