import { afterAll, beforeAll } from 'bun:test'
import { setup, teardown } from './helpers/tests'

beforeAll(async () => {
  await setup()
})

afterAll(async () => {
  await teardown()
})
