import { beforeEach, describe, expect, it } from 'vitest'
import db, { getTravelledStrides } from '../db'
import { upsertEvmLog } from './index'
import { strider } from 'lib'

const address = '0x0000000000000000000000000000000000000483'
const payload = { chainId: 1, address, from: 100n, to: 200n, batch: [] }
const log = { chainId: 1, address, eventName: 'Deposit', signature: '0x01', topics: ['0x01'], args: {}, hook: {}, blockNumber: 100n, blockTime: 100n, logIndex: 0, transactionIndex: 0, transactionHash: '0x01' }

beforeEach(async () => {
  await db.query('DELETE FROM evmlog_reader_strides WHERE address = $1', [address])
  await db.query('DELETE FROM evmlog_strides WHERE address = $1', [address])
  await db.query('DELETE FROM evmlog WHERE address = $1', [address])
})

describe('reader coverage', () => {
  it('does not inherit coverage from another reader or the legacy table', async () => {
    await db.query('INSERT INTO evmlog_strides VALUES (1, $1, $2)', [address, JSON.stringify([{ from: '100', to: '200' }])])
    await upsertEvmLog({ ...payload, abiPath: 'erc4626' })
    expect(await getTravelledStrides(1, address, 'yearn/3/vault')).toBeUndefined()
    expect(await getTravelledStrides(1, address, 'erc4626')).toEqual([{ from: 100n, to: 200n }])
  })

  it('merges concurrent first loads without losing ranges', async () => {
    await Promise.all([
      upsertEvmLog({ ...payload, abiPath: 'erc4626', to: 150n }),
      upsertEvmLog({ ...payload, abiPath: 'erc4626', from: 151n })
    ])
    expect(await getTravelledStrides(1, address, 'erc4626')).toEqual([{ from: 100n, to: 200n }])
  })

  it('keeps hook fields from both readers, including a legacy empty-hook load', async () => {
    await Promise.all([
      upsertEvmLog({ ...payload, abiPath: 'erc4626', batch: [{ ...log, hook: { erc4626: true } }] }),
      upsertEvmLog({ ...payload, abiPath: 'yearn/3/vault', batch: [{ ...log, hook: { yearn: true } }] })
    ])
    await upsertEvmLog({ ...payload, batch: [log] })
    expect((await db.query('SELECT hook FROM evmlog WHERE address = $1', [address])).rows[0].hook).toEqual({ erc4626: true, yearn: true })
  })

  it('does not credit legacy jobs and rolls back coverage when saving fails', async () => {
    await upsertEvmLog(payload)
    expect(await getTravelledStrides(1, address, 'erc4626')).toBeUndefined()
    await expect(upsertEvmLog({ ...payload, abiPath: 'erc4626', batch: [{ ...log, logIndex: 2147483648 }] })).rejects.toThrow()
    expect(await getTravelledStrides(1, address, 'erc4626')).toBeUndefined()
  })

  it('does not create reader coverage for an empty replay', async () => {
    await upsertEvmLog({ ...payload, abiPath: 'erc4626', replay: true })
    expect(await getTravelledStrides(1, address, 'erc4626')).toBeUndefined()
  })

  it('saves replay logs without claiming replay coverage', async () => {
    await upsertEvmLog({ ...payload, abiPath: 'erc4626', from: 100n, to: 150n })
    expect(await getTravelledStrides(1, address, 'erc4626')).toEqual([{ from: 100n, to: 150n }])

    await upsertEvmLog({
      ...payload,
      abiPath: 'erc4626',
      from: 100n,
      to: 200n,
      replay: true,
      batch: [{ ...log, hook: { replayed: true } }]
    })

    expect(await getTravelledStrides(1, address, 'erc4626')).toEqual([{ from: 100n, to: 150n }])
    expect((await db.query('SELECT hook FROM evmlog WHERE address = $1', [address])).rows[0].hook).toEqual({ replayed: true })
  })

  it('replans rolled-back history independently for each reader', async () => {
    for (const abiPath of ['erc4626', 'yearn/3/vault']) {
      await upsertEvmLog({ ...payload, abiPath })
      const coverage = await getTravelledStrides(1, address, abiPath)
      const clipped = strider.rollback(coverage!, 150n)
      await db.query('UPDATE evmlog_reader_strides SET strides = $1 WHERE chain_id = 1 AND address = $2 AND abi_path = $3', [JSON.stringify(clipped), address, abiPath])
      expect(strider.plan(100n, 200n, await getTravelledStrides(1, address, abiPath))).toEqual([{ from: 151n, to: 200n }])
    }
  })
})
