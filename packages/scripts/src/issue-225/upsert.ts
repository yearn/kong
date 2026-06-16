import 'lib/global'

import db from 'ingest/db'
import { promoteTempTable } from '../backfill-shared/upsert'

/**
 * Promote recomputed fapy + oracle apy outputs from the temp table into the
 * production output table (value-only update on conflict; drops the temp table).
 * Run compute.ts first.
 */

const TEMP_TABLE = 'output_temp_fapy_oracle'

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
