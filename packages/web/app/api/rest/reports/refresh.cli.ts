import { disconnect } from '../cache'
import { refreshLatest } from './refresh'

refreshLatest()
  .then(async () => {
    await disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await disconnect()
    process.exit(1)
  })
