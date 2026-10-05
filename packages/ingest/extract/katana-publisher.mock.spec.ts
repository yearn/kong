import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { OutputSchema } from 'lib/types'
import subscriptions from 'lib/subscriptions'
import path from 'node:path'
const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '../../web/app/api/gql/typeDefs/fixtures/katana-publisher.json'), 'utf8'))
import { selectValidOutputs } from './webhook'

describe('Katana publisher subscription contract', () => {
  it('accepts the publisher outputs with the label Kong sends in its subscription request', () => {
    const subscription = subscriptions.find(entry => entry.id === 'S_KATANA_APR')!
    const outputs = OutputSchema.array().parse(fixture.outputs)
    expect(subscription.labels[0]).toBe('katana-estimated-apr')
    expect(selectValidOutputs(outputs, {
      subscription, abiPath: subscription.abiPath, chainId: 747474, blockNumber: 123n, blockTime: 456n, vaults: [outputs[0].address]
    })).toEqual(outputs)
  })
})
