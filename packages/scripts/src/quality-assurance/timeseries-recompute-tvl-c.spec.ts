import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'

const script = './timeseries-recompute-tvl-c.ts'

describe('timeseries-recompute-tvl-c', () => {
  test('without --vaults, returns origin=yearn vaults with tvl >= 500', async () => {
    const result = await $`bun ${script}`.text()
    const match = result.match(/Target vaults count: (\d+)/)
    expect(match).not.toBeNull()
    const count = Number(match![1])
    expect(count).toBeGreaterThan(0)
  }, 120000)

  test('with --vaults, returns only specified vaults', async () => {
    const vaults = '1:0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD,8453:0x4B5c90DC6Bc08A10a24487726e614e9d148362E1'
    const result = await $`bun ${script} --vaults ${vaults}`.text()
    expect(result).toContain('Target vaults count: 2')
  }, 120000)

  test('with --vaults, normalizes addresses via getAddress', async () => {
    // lowercase input gets checksummed and matched
    const vaults = '1:0xa3931d71877c0e7a3148cb7eb4463524fec27fbd'
    const result = await $`bun ${script} --vaults ${vaults}`.text()
    expect(result).toContain('Target vaults count: 1')
  }, 120000)

  test('with --vaults, throws error for invalid address', async () => {
    const vaults = '1:0xINVALID'
    const proc = Bun.spawn(['bun', script, '--vaults', vaults], {
      cwd: import.meta.dir,
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    expect(exitCode).toBe(1)
    expect(stderr).toContain('InvalidAddressError')
  })

  test('with --vaults, throws error if vault not found', async () => {
    // Valid address format but not in the vault list
    const vaults = '1:0x0000000000000000000000000000000000000001'
    const proc = Bun.spawn(['bun', script, '--vaults', vaults], {
      cwd: import.meta.dir,
      stderr: 'pipe',
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    expect(exitCode).toBe(1)
    expect(stderr).toContain('Vault not found')
  })
})
