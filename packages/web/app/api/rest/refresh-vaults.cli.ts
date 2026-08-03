import { disconnect } from './cache'
import { refresh } from './refresh-vaults'

refresh()
  .then(async () => {
    await disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await disconnect()
    process.exit(1)
  })
