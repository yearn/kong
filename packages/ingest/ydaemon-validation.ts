import path from 'path'
import dotenv from 'dotenv'
const envPath = path.join(__dirname, '../../.env')
dotenv.config({ path: envPath })



import 'lib/global'
import BigDecimal from 'js-big-decimal'
import processFapy from './abis/yearn/3/vault/timeseries/fapy/hook'
import { rpcs } from 'lib/rpcs'
import { cache } from 'lib'

async function validateFapy() {
  console.time('⏱️  Total execution time')

  console.time('⏱️  RPC initialization')
  await rpcs.up()
  await cache.up()
  console.timeEnd('⏱️  RPC initialization')

  const VAULT_ADDRESS = ('0xf165a634296800812B8B0607a75DeDdcD4D3cC88') as `0x${string}`
  const CHAIN_ID = parseInt('1', 10)
  try {
    console.time('⏱️  yDaemon API fetch')
    const ydaemonData = await fetch(`https://ydaemon.yearn.fi/${CHAIN_ID}/vaults/${VAULT_ADDRESS}`)
    if (!ydaemonData.ok) {
      throw new Error(`Failed to fetch yDaemon data: ${ydaemonData.statusText}`)
    }
    const ydaemonDataJson = await ydaemonData.json()
    console.timeEnd('⏱️  yDaemon API fetch')
    const ydaemonAPY = ydaemonDataJson.apr.forwardAPR

    console.time('⏱️  FAPY calculation')
    const fapy = await processFapy(CHAIN_ID, VAULT_ADDRESS, {
      abiPath: 'yearn/3/vault',
      chainId: CHAIN_ID,
      address: VAULT_ADDRESS,
      outputLabel: 'fapy',
      blockTime: BigInt(Math.floor(Date.now() / 1000) - 3600)
    })
    console.timeEnd('⏱️  FAPY calculation')

    interface KongAPY {
      netAPR?: number;
      forwardBoost?: number;
      poolAPY?: number;
      boostedAPR?: number;
      baseAPR?: number;
      rewardsAPY?: number;
      cvxAPR?: number;
    }

    const kongAPY = fapy.reduce((acc: KongAPY, curr: { component?: string | null; value?: number | null }) => {
      if(curr.component) {
        (acc as any)[curr.component] = curr.value ?? 0
      }
      return acc
    }, {} as KongAPY)

    const comparisons = [
      { name: 'netAPR', ydaemon: ydaemonAPY.netAPR, kong: kongAPY.netAPR },
      { name: 'forwardBoost', ydaemon: ydaemonAPY.composite.boost, kong: kongAPY.forwardBoost },
      { name: 'poolAPY', ydaemon: ydaemonAPY.composite.poolAPY, kong: kongAPY.poolAPY },
      { name: 'boostedAPR', ydaemon: ydaemonAPY.composite.boostedAPR, kong: kongAPY.boostedAPR },
      { name: 'baseAPR', ydaemon: ydaemonAPY.composite.baseAPR, kong: kongAPY.baseAPR },
      { name: 'cvxAPR', ydaemon: ydaemonAPY.composite.cvxAPR, kong: kongAPY.cvxAPR },
      { name: 'rewardsAPY', ydaemon: ydaemonAPY.composite.rewardsAPR, kong: kongAPY.rewardsAPY }
    ]

    console.time('⏱️  Comparison logic')
    for (const comp of comparisons) {
      const ydaemonValueRaw = comp.ydaemon
      const kongValueRaw = comp.kong
      const ydaemonValue = new BigDecimal(ydaemonValueRaw?.toString() || '0').round(1, BigDecimal.RoundingModes.HALF_UP).getValue()
      const kongValue = new BigDecimal(kongValueRaw?.toString() || '0').round(1, BigDecimal.RoundingModes.HALF_UP).getValue()

      if (ydaemonValue !== kongValue) {
        console.log(`DEBUG: Raw yDaemon ${comp.name}: ${ydaemonValueRaw}`)
        console.log(`DEBUG: Raw Kong ${comp.name}: ${kongValueRaw}`)
        throw new Error(`Mismatch for ${comp.name}: yDaemon = ${ydaemonValue}, Kong = ${kongValue}`)
      }
      console.log(`✅ ${comp.name} matches: ${ydaemonValue}`)
    }
    console.timeEnd('⏱️  Comparison logic')

    console.log('FAPY validation successful!')
    console.timeEnd('⏱️  Total execution time')

    process.exit(0)
  } catch (error) {
    console.error('FAPY validation failed:', error)
    console.timeEnd('⏱️  Total execution time')
    process.exit(1) // Exit with a non-zero code to indicate failure
  }
}

validateFapy()
