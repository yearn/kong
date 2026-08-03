import { cacheMSet } from '../cache'
import { Shard, selectShard } from '../shard'
import { getFullTimeseries, getVaults, TimeseriesRow } from './db'
import { labels } from './labels'
import { getTimeseriesKey } from './redis'

const BATCH_SIZE = 10

export async function refreshHistorical(shard?: Shard): Promise<void> {
  console.time('refreshHistorical')

  console.log('Fetching vaults...')
  const all = await getVaults()
  const vaults = selectShard(all, (vault) => `${vault.chainId}:${vault.address.toLowerCase()}`, shard)
  const scope = shard ? ` (shard ${shard.index + 1}/${shard.total} of ${all.length})` : ''
  console.log(`Found ${vaults.length} vaults${scope} (batch size: ${BATCH_SIZE})`)

  let processed = 0

  for (let i = 0; i < vaults.length; i += BATCH_SIZE) {
    const batch = vaults.slice(i, i + BATCH_SIZE)
    const pairs: Array<[string, string]> = []

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

  console.log(`✓ Completed: ${processed} vaults processed`)
  console.timeEnd('refreshHistorical')
}
