// Load environment variables first
import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

// Other imports after environment is loaded
import { rpcs } from 'lib/rpcs'
import process, { outputLabel } from './abis/yearn/3/vault/timeseries/fapy/hook'
import { Data } from './extract/timeseries'
import { cache } from 'lib'
import 'lib/global'

// Vault data provided by the user
const VAULT_ADDRESS = '0xf165a634296800812B8B0607a75DeDdcD4D3cC88' as `0x${string}`
const CHAIN_ID = 1 // Ethereum mainnet

// Create sample data
const sampleData: Data = {
  abiPath: 'yearn/3/vault',
  chainId: 1,
  address: '0xf165a634296800812B8B0607a75DeDdcD4D3cC88',
  outputLabel,
  blockTime: BigInt(Math.floor(Date.now() / 1000) - 3600)
}

// Enable more detailed logging
console.debug = console.log

// Add debugging points
const run = async () => {
  await rpcs.up()
  await cache.up()
  console.log('Starting debugger for fapy hook')
  console.log('Input parameters:', {
    chainId: CHAIN_ID,
    address: VAULT_ADDRESS,
    blockTime: new Date(Number(sampleData.blockTime) * 1000).toISOString()
  })

  try {
    const result = await process(CHAIN_ID, VAULT_ADDRESS, sampleData)
    console.log('Result:', result)
    return []
  } catch (error) {
    console.error('Error during processing:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    return
  }
}

run()
