import { createKeyvClient } from '../cache'
import { getFullTimeseries, getVaults, TimeseriesRow } from './db'
import { labels } from './labels'
import { getTimeseriesKey } from './redis'

const keyv = createKeyvClient()

const BATCH_SIZE = 10

async function refresh24hr(): Promise<void> {
  console.time('refresh24hr')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const entries: Array<{ key: string; value: unknown }> = []

    await Promise.all(batch.map(async (vault) => {
      const addressLower = vault.address.toLowerCase()

      await Promise.all(labels.map(async ({ label }) => {
        const rows: TimeseriesRow[] = await getFullTimeseries(
          vault.chainId,
          vault.address,
          label,
        )

        const minimal = rows.map(row => ({
          time: Number(row.time),
          component: row.component,
          value: row.value,
        }))

        entries.push({
          key: getTimeseriesKey(label, vault.chainId, addressLower),
          value: minimal,
        })
      }))
    }))

    await keyv.setMany(entries)

    processed += batch.length
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refresh24hr')
}

if (require.main === module) {
  refresh24hr()
    .then(async () => {
      await keyv.disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await keyv.disconnect()
      process.exit(1)
    })
}
