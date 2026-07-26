import { cacheMSet, disconnect } from '../cache'
import { getFullTimeseries, getTranches, getTrancheControllers, getVaults, TimeseriesRow } from './db'
import { trancheControllerLabels, trancheLabels, vaultLabels } from './labels'
import { getTimeseriesKey } from './redis'

const BATCH_SIZE = 10

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

      await Promise.all(vaultLabels.map(async ({ label }) => {
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

        pairs.push([
          getTimeseriesKey(label, vault.chainId, addressLower),
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

  // Narrower scopes get their own pass rather than a query per vault: tranche
  // series only exist at tranches, and a controller isn't a vault at all.
  const scoped = [
    { addresses: await getTranches(), labels: trancheLabels },
    { addresses: await getTrancheControllers(), labels: trancheControllerLabels },
  ]

  const scopedPairs: Array<[string, string]> = []

  for (const { addresses, labels } of scoped) {
    for (const { chainId, address } of addresses) {
      for (const { label } of labels) {
        const rows: TimeseriesRow[] = await getFullTimeseries(chainId, address, label)

        scopedPairs.push([
          getTimeseriesKey(label, chainId, address.toLowerCase()),
          JSON.stringify({
            value: rows.map(row => ({
              time: Number(row.time),
              component: row.component,
              value: row.value,
            })),
          }),
        ])
      }
    }
  }

  await cacheMSet(scopedPairs)

  console.log(`✓ Completed: ${processed} vaults, ${scopedPairs.length} tranche series processed`)
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
