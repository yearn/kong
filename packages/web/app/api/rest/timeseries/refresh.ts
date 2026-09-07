import { cronDb } from '../../db/cron'
import { cacheMSet } from '../cache'
import { getRecentTimeseries, getVaults, TimeseriesRow } from './db'
import { labels } from './labels'
import { getTimeseriesLatestKey } from './redis'

const BATCH_SIZE = 10

export async function refreshLatest(): Promise<void> {
  const started = Date.now()

  try {
    console.log('Fetching vaults...')
    const vaults = await getVaults(cronDb)
    console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

    let processed = 0

    for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
      const batch = vaults.slice(i, i + BATCH_SIZE)
      const pairs: Array<[string, string]> = []

      await Promise.all(batch.map(async (vault) => {
        const addressLower = vault.address.toLowerCase()

        await Promise.all(labels.map(async ({ label }) => {
          const rows: TimeseriesRow[] = await getRecentTimeseries(
            vault.chainId,
            vault.address,
            label,
            cronDb,
          )

          const minimal = rows.map(row => ({
            time: Number(row.time),
            component: row.component,
            value: row.value,
          }))

          pairs.push([
            getTimeseriesLatestKey(label, vault.chainId, addressLower),
            JSON.stringify({ value: minimal }),
          ])
        }))
      }))

      await cacheMSet(pairs)

      processed += batch.length
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${vaults.length} vaults`)
      }
    }

    console.log(`✓ Completed: ${processed} vaults processed`)
  } finally {
    console.log(`refreshLatest: ${Date.now() - started}ms`)
  }
}
