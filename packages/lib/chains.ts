import * as yaml from 'js-yaml'
import * as fs from 'fs'
import path from 'path'
import { defineChain } from 'viem'
import { arbitrum, base, fantom, gnosis, mainnet, optimism, polygon } from 'viem/chains'

export const customChains = {
  mode: /*#__PURE__*/ defineChain({
    id: 34443,
    name: 'Mode Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: {
        http: ['https://mainnet.mode.network'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Mode Explorer',
        url: 'https://explorer.mode.network',
      },
    },
    contracts: {
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 2465882,
      },
    },
  }),

  sonic: /*#__PURE__*/ defineChain({
    id: 146,
    name: 'Sonic',
    nativeCurrency: {
      decimals: 18,
      name: 'Sonic',
      symbol: 'S',
    },
    rpcUrls: {
      default: { http: ['https://rpc.soniclabs.com'] },
    },
    blockExplorers: {
      default: {
        name: 'Sonic Explorer',
        url: 'https://sonicscan.org/',
      },
    },
    contracts: {
      multicall3: {
        address: '0xca11bde05977b3631167028862be2a173976ca11',
        blockCreated: 60,
      },
    },
    testnet: false,
  })
}

const viemchains = { arbitrum, base, fantom, gnosis, mainnet, optimism, polygon, ...customChains }

interface YamlConfig { chains: string [] }

const yamlPath = (() => {
  const local = path.join(__dirname, '../../config', 'chains.local.yaml')
  const production = path.join(__dirname, '../../config', 'chains.yaml')
  if(fs.existsSync(local)) return local
  return production
})()

const yamlFile = fs.readFileSync(yamlPath, 'utf8')
const config = yaml.load(yamlFile) as YamlConfig
const chains = config.chains.map(name => {
  const viemchain = viemchains[name as keyof typeof viemchains]
  if(!viemchain) throw new Error(`chain not found, ${name}`)
  return viemchain
})

export { chains }
export default chains
