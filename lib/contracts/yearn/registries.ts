import * as types from '../../types'
import { parseAbi } from 'viem'
import { arbitrum, fantom, mainnet, optimism, polygon } from 'viem/chains'

const mainnetContracts = {
  'registry-0': {
    address: '0xe15461b18ee31b7379019dc523231c57d1cbc18c' as `0x${string}`,
    incept: 11563389n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed deployment_id, address vault, string api_version)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0xe15461b18ee31b7379019dc523231c57d1cbc18c' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.api_version.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  },

  'registry-1': {
    address: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804' as `0x${string}`,
    incept: 12045555n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed vault_id, address vault, string api_version)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0x50c1a2eA0a861A967D9d0FFE2AE4012c2E053804' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.api_version.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  },

  'registry-2': {
    address: '0xaF1f5e1c19cB68B30aAD73846eFfDf78a5863319' as `0x${string}`,
    incept: 16215519n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed vaultId, uint256 vaultType, address vault, string apiVersion)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0xaF1f5e1c19cB68B30aAD73846eFfDf78a5863319' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.apiVersion.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  }
}

const optimismContracts = {
  'registry-0': {
    address: '0x1ba4eB0F44AB82541E56669e18972b0d6037dfE0' as `0x${string}`,
    incept: 18099370n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed vault_id, address vault, string api_version)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0x1ba4eB0F44AB82541E56669e18972b0d6037dfE0' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.api_version.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  }
}

const polygonContracts = {
  'registry-0': {
    address: '0x6CA1019276995aFc2E76231eDd3A3fF1C3b71CEE' as `0x${string}`,
    incept: 45348480n,
    events: parseAbi([
      `event NewEndorsedVault(address indexed vault, address indexed asset, uint256 releaseVersion)`,
      `event NewEndorsedStrategy(address indexed vault, address indexed asset, uint256 releaseVersion)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0x6CA1019276995aFc2E76231eDd3A3fF1C3b71CEE' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        assetAddress: log.args.asset.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault),
      NewStrategy: (log: any) => ({
        registry: '0x6CA1019276995aFc2E76231eDd3A3fF1C3b71CEE' as `0x${string}`,
        endorsed: true,
        type: 'strategy',
        address: log.args.vault.toString(),
        assetAddress: log.args.asset.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  }
}

const fantomContracts = {
  'registry-0': {
    address: '0x727fe1759430df13655ddb0731dE0D0FDE929b04' as `0x${string}`,
    incept: 18455565n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed vault_id, address vault, string api_version)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0x727fe1759430df13655ddb0731dE0D0FDE929b04' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.api_version.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  }
}

const arbitrumContracts = {
  'registry-0': {
    address: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f' as `0x${string}`,
    incept: 4841854n,
    events: parseAbi([
      `event NewVault(address indexed token, uint256 indexed vault_id, address vault, string api_version)`
    ]),
    parser: {
      NewVault: (log: any) => ({
        registry: '0x3199437193625DCcD6F9C9e98BDf93582200Eb1f' as `0x${string}`,
        endorsed: true,
        type: 'vault',
        address: log.args.vault.toString(),
        apiVersion: log.args.api_version.toString(),
        assetAddress: log.args.token.toString(),
        asOfBlockNumber: log.blockNumber.toString()
      } as types.Vault)
    }
  }
}

class Contracts {
  private contracts = {
    [mainnet.id as number]: mainnetContracts,
    [optimism.id as number]: optimismContracts,
    [polygon.id as number]: polygonContracts,
    [fantom.id as number]: fantomContracts,
    [arbitrum.id as number]: arbitrumContracts
  }

  for(chainId: any) {
    return this.contracts[chainId as number]    
  }

  at(chainId: any, key: any) {
    const forChain = this.for(chainId)
    return forChain[key as keyof typeof forChain]
  }
}

export const contracts = new Contracts()
