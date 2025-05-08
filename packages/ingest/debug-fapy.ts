// Load environment variables first
import path from 'path'
import dotenv from 'dotenv'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

// Other imports after environment is loaded
import { rpcs } from 'lib/rpcs'
import process, { outputLabel } from './fapy/hook'
import { Data } from './extract/timeseries'
import { cache } from 'lib'
import 'lib/global'

// Vault data provided by the user
const VAULT_ADDRESS = '0x74E37A751e163f66148402198DA13DF5dC47cFaF' as `0x${string}`
const CHAIN_ID = 1 // Ethereum mainnet
const VAULT_NAME = 'Curve sDOLA-scrvUSD Factory yVault'

// Create sample data
const sampleData: Data = {
  abiPath: 'yearn/3/vault',
  chainId: 1,
  address: '0x74E37A751e163f66148402198DA13DF5dC47cFaF',
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
    vaultName: VAULT_NAME,
    blockTime: new Date(Number(sampleData.blockTime) * 1000).toISOString()
  })

  try {
    const result = await process(CHAIN_ID, VAULT_ADDRESS, sampleData)
  } catch (error) {
    console.error('Error during processing:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
  }
}

run()
