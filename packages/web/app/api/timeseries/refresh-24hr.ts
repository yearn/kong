import { labels } from './labels'
import { getFullTimeseries, getVaults, TimeseriesRow } from './db'
import { createTimeseriesKeyv, getTimeseriesKey } from './redis'

const BATCH_SIZE = 5

async function refresh24hr(): Promise<void> {
  console.time('refresh24hr')
  const keyv = createTimeseriesKeyv()

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  async function processVault(vault: { chainId: number; address: string }) {
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

      const cacheKey = getTimeseriesKey(label, vault.chainId, addressLower)
      await keyv.set(cacheKey, JSON.stringify(minimal))
    }))

    processed++
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(processVault))
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refresh24hr')
}

if (require.main === module) {
  refresh24hr()
    .then(() => {
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
