import { disconnect } from '../cache'
import { refreshHistorical } from './refresh-historical'

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
