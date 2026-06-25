import { cacheMSet, disconnect } from '../cache'
import { getFullTimeseries, getVaults } from './db'
import { labels } from './labels'
import { getTimeseriesKey } from './redis'

const BATCH_SIZE = 10
const EMPTY_SERIES = '{"value": []}'
const labelList = labels.map(({ label }) => label)

async function refreshHistorical(): Promise<void> {
  console.time('refreshHistorical')

  console.log('Fetching vaults...')
  const vaults = await getVaults()
  console.log(`Found ${vaults.length} vaults (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const pairs: Array<[string, string]> = []

    await Promise.all(batch.map(async (vault) => {
      const addressLower = vault.address.toLowerCase()
      // One indexed query per vault for all labels; payloads are ready-to-cache
      // `{"value":[…]}` envelopes built in SQL.
      const byLabel = new Map(
        (await getFullTimeseries(vault.chainId, vault.address, labelList))
          .map(({ label, payload }) => [label, payload]),
      )

      // Write every label (empty when the vault has none) so a label that lost
      // its data still gets cleared, matching the old per-label overwrite.
      for (const label of labelList) {
        pairs.push([
          getTimeseriesKey(label, vault.chainId, addressLower),
          byLabel.get(label) ?? EMPTY_SERIES,
        ])
      }
    }))

    await cacheMSet(pairs)

    processed += batch.length
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${vaults.length} vaults`)
    }
  }

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refreshHistorical')
}

if (require.main === module) {
  refreshHistorical()
    .then(async () => {
      await disconnect()
      process.exit(0)
    })
    .catch(async (err) => {
      console.error(err)
      await disconnect()
      process.exit(1)
    })
}
