import 'lib/global'
import path from 'path'
import dotenv from 'dotenv'
import chai from 'chai'
import chaiAlmost from 'chai-almost'
import { rpcs } from './rpcs'
import db from './db'
import { cache } from 'lib'

const envPath = path.join(__dirname, '../..', '.env')
dotenv.config({ path: envPath })

chai.use(chaiAlmost())

export const mochaGlobalSetup = async function() {
  await Promise.all([rpcs.up(), cache.up()])
  console.log('⬆', 'test fixture up')
}

export const mochaGlobalTeardown = async () => {
  await Promise.all([db.end(), rpcs.down(), cache.down()])
  console.log('⬇', 'test fixture down')
}

export const addresses = {
  v2: {
    yvusdt: '0x3B27F92C0e212C671EA351827EDF93DB27cc0c65' as `0x${string}`,
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`,
    strategyLenderYieldOptimiser: '0xd8F414beB0aEb5784c5e5eBe32ca9fC182682Ff8' as `0x${string}`,
  
    yvweth: '0xa258C4606Ca8206D8aA700cE2143D7db854D168c' as `0x${string}`,
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`,
    genericLevCompFarmWeth: '0x83B6211379c26E0bA8d01b9EcD4eE1aE915630aa' as `0x${string}`,
    strategystEthAccumulator_v2: '0x120FA5738751b275aed7F7b46B98beB38679e093' as `0x${string}`,
  },

  v3: {
    registry: '0xfF5e3A7C4cBfA9Dd361385c24C3a0A4eE63CE500' as `0x${string}`,
    yvusdca: '0xA013Fbd4b711f9ded6fB09C1c0d358E2FbC2EAA0' as `0x${string}`,
    yvusdca_debtManager: '0x62833b804624452F165272D183193f7D0Df97ab3' as `0x${string}`,
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as `0x${string}`,
    aaveV3UsdcLender: '0xdB92B89Ca415c0dab40Dc96E99Fc411C08F20780' as `0x${string}`,
    compoundV3UsdcLender: '0xb1403908F772E4374BB151F7C67E88761a0Eb4f1' as `0x${string}`,
    stargateUsdcStaker: '0x8BBa7AFd0f9B1b664C161EC31d812a8Ec15f7e1a' as `0x${string}`
  },

  rando: '0x1B243724A773092Df465B20186aF39Ae0A90fC26' as `0x${string}`
}
