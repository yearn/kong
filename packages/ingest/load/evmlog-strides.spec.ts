import { afterEach, expect, it } from 'vitest'
import db, { getTravelledStrides } from '../db'
import { upsertEvmLog } from './index'
const chainId = 31337
const address = '0x000000000000000000000000000000000000c057'
afterEach(async () => {
  await db.query('DELETE FROM evmlog_strides WHERE chain_id = $1 AND address = $2', [chainId, address])
})
it('retains every range from concurrent first loads, then handles redelivery idempotently', async () => {
  await db.query('DELETE FROM evmlog_strides WHERE chain_id = $1 AND address = $2', [chainId, address])
  const jobs = Array.from({ length: 20 }, (_, i) => ({ chainId, address, from: BigInt(i * 10), to: BigInt(i * 10 + 9), batch: [] }))
  await Promise.all(jobs.map(upsertEvmLog))
  expect(await getTravelledStrides(chainId, address)).toEqual([{ from: 0n, to: 199n }])
  await Promise.all(jobs.map(upsertEvmLog))
  expect(await getTravelledStrides(chainId, address)).toEqual([{ from: 0n, to: 199n }])
})
