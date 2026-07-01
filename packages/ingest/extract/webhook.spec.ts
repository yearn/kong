import { strict as assert } from 'node:assert'
import { selectValidOutputs, readJsonCapped, MAX_OUTPUTS_PER_VAULT } from './webhook'
import type { Data } from './webhook'
import type { Output } from 'lib/types'
import type { WebhookSubscription } from 'lib/subscriptions'

const VAULT_A = '0x1111111111111111111111111111111111111111'
const VAULT_B = '0x2222222222222222222222222222222222222222'
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
  it('keeps outputs for requested vaults with allowed labels', () => {
    const valid = selectValidOutputs([output(VAULT_A), output(VAULT_B)], data([VAULT_A, VAULT_B]))
    assert.equal(valid.length, 2)
  })

  it('drops outputs for vaults that were not requested', () => {
    const valid = selectValidOutputs([output(OUT_OF_SCOPE)], data([VAULT_A]))
    assert.equal(valid.length, 0)
  })

  it('drops outputs for a different chain than requested', () => {
    const valid = selectValidOutputs([output(VAULT_A, 'apr', 10)], data([VAULT_A], 1))
    assert.equal(valid.length, 0)
  })

  it('matches vault addresses case-insensitively', () => {
    const valid = selectValidOutputs([output(VAULT_A.toUpperCase().replace('0X', '0x'))], data([VAULT_A.toLowerCase()]))
    assert.equal(valid.length, 1)
  })

  it('drops a vault group with an unexpected label', () => {
    const valid = selectValidOutputs([output(VAULT_A, 'not-allowed')], data([VAULT_A]))
    assert.equal(valid.length, 0)
  })

  it('drops a vault group over the per-vault cap', () => {
    const many = Array.from({ length: MAX_OUTPUTS_PER_VAULT + 1 }, () => output(VAULT_A))
    const valid = selectValidOutputs(many, data([VAULT_A]))
    assert.equal(valid.length, 0)
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
