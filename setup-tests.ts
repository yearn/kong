import 'lib/global'
import { config } from 'dotenv'
import { afterAll, beforeAll } from 'bun:test'
import path from 'path'
import { setup, teardown } from './packages/lib/helpers/tests'

const envPath = path.join(__dirname, '.env')
config({ path: envPath })

let isSetup = false

beforeAll(async () => {
  // Only run setup once
  if (!isSetup) {
    await setup()
    isSetup = true
  }
})

afterAll(async () => {
  // Only run teardown once
  if (isSetup) {
    await teardown()
    isSetup = false
  }
})

// Export the setup state so packages can check it
export { isSetup }
