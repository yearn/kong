import { strict as assert } from 'node:assert'
import { mq } from 'lib'
import {
  MAX_OUTPUT_GROUPS,
  MAX_OUTPUTS_PER_ADDRESS,
  MAX_TOTAL_OUTPUTS,
  readJsonCapped,
  selectValidOutputs,
  WebhookExtractor
} from './webhook'
import type { Data } from './webhook'
import type { Output } from 'lib/types'
import type { WebhookSubscription } from 'lib/subscriptions'

const VAULT_A = '0x1111111111111111111111111111111111111111'
const OUT_OF_SCOPE = '0x3333333333333333333333333333333333333333'

const subscription: WebhookSubscription = {
  id: 'S_TEST',
  url: 'https://example.com/webhook',
  abiPath: 'yearn/2/vault',
  type: 'timeseries',
  labels: ['apr']
}

function data(vaults: string[], chainId = 1): Data {
  return {
    abiPath: 'yearn/2/vault',
    chainId,
    blockNumber: 1n,
    blockTime: 1n,
    subscription,
    vaults: vaults as `0x${string}`[]
  }
}

function output(address: string, label = 'apr', chainId = 1): Output {
  return {
    chainId,
    address: address as `0x${string}`,
    label,
    component: 'net',
    value: 1,
    blockNumber: 1n,
    blockTime: 1n
  }
}

describe('selectValidOutputs', () => {
  it('keeps configured-label outputs for an address other than the triggering vault', () => {
    assert.deepEqual(selectValidOutputs([output(OUT_OF_SCOPE)], data([VAULT_A])), [output(OUT_OF_SCOPE)])
  })

  it('drops outputs for a different chain than requested', () => {
    assert.deepEqual(selectValidOutputs([output(OUT_OF_SCOPE, 'apr', 10)], data([VAULT_A])), [])
  })

  it('drops a group with an unexpected label', () => {
    assert.deepEqual(selectValidOutputs([output(OUT_OF_SCOPE, 'not-allowed')], data([VAULT_A])), [])
  })

  it('drops a group over the per-address cap', () => {
    const many = Array.from({ length: MAX_OUTPUTS_PER_ADDRESS + 1 }, () => output(OUT_OF_SCOPE))
    assert.deepEqual(selectValidOutputs(many, data([VAULT_A])), [])
  })

  it('drops a response over the total output cap', () => {
    const many = Array.from({ length: MAX_TOTAL_OUTPUTS + 1 }, () => output(OUT_OF_SCOPE))
    assert.deepEqual(selectValidOutputs(many, data([VAULT_A])), [])
  })

  it('drops a response over the output group cap', () => {
    const many = Array.from({ length: MAX_OUTPUT_GROUPS + 1 }, (_, i) => output(`0x${i.toString(16).padStart(40, '0')}`))
    assert.deepEqual(selectValidOutputs(many, data([VAULT_A])), [])
  })
})

describe('WebhookExtractor', () => {
  it('loads a cross-address output without composition lookup', async () => {
    const originalFetch = globalThis.fetch
    const originalSecret = process.env.WEBHOOK_SECRET_S_TEST
    const responseOutput = {
      ...output(OUT_OF_SCOPE),
      blockNumber: '1',
      blockTime: '1'
    }
    const add = vi.spyOn(mq, 'add').mockResolvedValue({} as never)
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([responseOutput])))
    process.env.WEBHOOK_SECRET_S_TEST = 'secret'

    try {
      await new WebhookExtractor().extract(data([VAULT_A]))

      assert.equal(add.mock.calls.length, 1)
      assert.deepEqual(add.mock.calls[0], [
        mq.job.load.output,
        { batch: [output(OUT_OF_SCOPE)] }
      ])
    } finally {
      add.mockRestore()
      globalThis.fetch = originalFetch
      if (originalSecret === undefined) delete process.env.WEBHOOK_SECRET_S_TEST
      else process.env.WEBHOOK_SECRET_S_TEST = originalSecret
    }
  })
})

describe('readJsonCapped', () => {
  it('parses a body under the cap', async () => {
    const response = new Response(JSON.stringify({ a: 1 }))
    assert.deepEqual(await readJsonCapped(response, 1024), { a: 1 })
  })

  it('rejects when the declared content-length exceeds the cap', async () => {
    const fake = { headers: { get: () => '999999' } } as unknown as Response
    await assert.rejects(() => readJsonCapped(fake, 10))
  })

  it('rejects when the streamed body exceeds the cap', async () => {
    const big = JSON.stringify(Array.from({ length: 1000 }, (_, i) => i))
    await assert.rejects(() => readJsonCapped(new Response(big), 10))
  })
})
